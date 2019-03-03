
import { Injectable, Injector } from '@angular/core';
import { clipboard, remote } from 'electron';
import * as storage from 'electron-json-storage';
import * as fs from 'fs';
import { cloneDeep } from 'lodash';
import { Subject } from 'rxjs/internal/Subject';
import { debounceTime } from 'rxjs/operators';
import { AnalyticsEvents } from 'src/app/enums/analytics-events.enum';
import { Errors } from 'src/app/enums/errors.enum';
import { Messages } from 'src/app/enums/messages.enum';
import { Migrations } from 'src/app/libs/migrations.lib';
import { AlertService } from 'src/app/services/alert.service';
import { DataService } from 'src/app/services/data.service';
import { EventsService } from 'src/app/services/events.service';
import { ServerService } from 'src/app/services/server.service';
import { SettingsService } from 'src/app/services/settings.service';
import { ReducerDirectionType } from 'src/app/stores/environments.reducer';
import { EnvironmentsStore, TabsNameType } from 'src/app/stores/environments.store';
import { DataSubjectType, ExportType } from 'src/app/types/data.type';
import { CurrentEnvironmentType, EnvironmentsType, EnvironmentType } from 'src/app/types/environment.type';
import { CORSHeaders, HeaderType, RouteType } from 'src/app/types/route.type';
import * as uuid from 'uuid/v1';

/**
 * WIP
 *
 * TODO
 *
 * review all actions for envs:
 * - add new DONE
 * - select active DONE
 * - remove DONE
 * - duplicate DONE
 * - select next / previous DONE
 * - move (dragula)
 * - conflict calculation
 * - update WIP --> done for top header
 *
 * review all actions for routes:
 * - add route DONE
 * - select route DONE
 * - remove route DONE
 * - duplicate DONE
 * - create when no environment DONE
 * - select next / previous DONE
 * - move (dragula)
 * - conflict calculation
 * - update
 *
 * misc:
 * - conflict calculation / duplicates, move it in a specific store?
 * - subscribe to store in order to save instead of triggering an envupdate event
 * - tab switching WIP (need to refactor when reintegrating missing sections from app)
 * - move environment running / startedAt, in specific array of the state
 * - to avoid restarts for small things bound to the route declaration (latency, etc) we should rely on the store because it's not anymore a passed by reference env object
 */


@Injectable()
export class EnvironmentsService {
  public selectEnvironment$: Subject<number> = new Subject<number>();
  // TODO remove and replace by a subscription:
  public environmentUpdateEvents: Subject<{
    environment?: EnvironmentType
  }> = new Subject<{
    environment: EnvironmentType
  }>();
  public environmentsReady: Subject<boolean> = new Subject<boolean>();
  public environments: EnvironmentsType;
  public routesTotal = 0;
  private serverService: ServerService;
  private dialog = remote.dialog;
  private BrowserWindow = remote.BrowserWindow;
  private environmentSchema: EnvironmentType = {
    uuid: '',
    running: false,
    name: '',
    endpointPrefix: '',
    latency: 0,
    port: 3000,
    routes: [],
    startedAt: null,
    modifiedAt: null,
    duplicates: [],
    needRestart: false,
    proxyMode: false,
    proxyHost: '',
    https: false,
    cors: true,
    headers: []
  };

  private environmentResetSchema: Partial<EnvironmentType> = {
    running: false,
    startedAt: null,
    modifiedAt: null,
    duplicates: [],
    needRestart: false
  };

  private routeSchema: RouteType = {
    uuid: '',
    documentation: '',
    method: 'get',
    endpoint: '',
    body: '{}',
    latency: 0,
    statusCode: '200',
    headers: [],
    file: null,
    duplicates: []
  };

  private emptyHeaderSchema: HeaderType = { uuid: '', key: '', value: '' };
  private routeHeadersSchema: HeaderType = { uuid: '', key: '', value: '' };

  private storageKey = 'environments';

  constructor(
    private alertService: AlertService,
    private dataService: DataService,
    private eventsService: EventsService,
    private settingsService: SettingsService,
    private environmentsStore: EnvironmentsStore,
    private injector: Injector
  ) {
    setTimeout(() => {
      this.serverService = this.injector.get(ServerService);
    });

    // get existing environments from storage or default one
    storage.get(this.storageKey, (error, environments) => {
      // if empty object
      if (Object.keys(environments).length === 0 && environments.constructor === Object) {
        // build default starting env
        const defaultEnvironment: EnvironmentType = this.buildDefaultEnvironment();

        this.environments = [defaultEnvironment];

        this.updateRoutesTotal();
        this.environmentsStore.setInitialState(this.environments);

        // this.environmentsReady.next(true);
      } else {
        // wait for settings to be ready before migrating and loading envs
        this.settingsService.settingsReady.subscribe((ready) => {
          if (ready) {
            const migratedData = this.migrateData(environments);
            this.environments = migratedData;
            // this.environmentsReady.next(true);

            this.environmentsStore.setInitialState(migratedData);
          }
        });
      }
    });

    // subscribe to environment data update from UI, and save
    this.environmentUpdateEvents.pipe(debounceTime(1000)).subscribe((params) => {
      this.updateRoutesTotal();

      storage.set(this.storageKey, this.cleanBeforeSave());
    });

    // subscribe to environment data update from UI
    this.environmentUpdateEvents.pipe(debounceTime(100)).subscribe((params) => {
      if (params.environment) {
        this.checkRoutesDuplicates(params.environment);
      }

      this.checkEnvironmentsDuplicates();
    });
  }

  /**
   * Set active environment by UUID or navigation
   */
  public setActiveEnvironment(environmentUUIDOrDirection: string | ReducerDirectionType) {
    if (this.environmentsStore.getEnvironments().activeEnvironmentUUID !== environmentUUIDOrDirection) {
      if (environmentUUIDOrDirection === 'next' || environmentUUIDOrDirection === 'previous') {
        this.environmentsStore.update({ type: 'NAVIGATE_ENVIRONMENTS', direction: environmentUUIDOrDirection });
      } else {
        this.environmentsStore.update({ type: 'SET_ACTIVE_ENVIRONMENT', UUID: environmentUUIDOrDirection });
      }

      this.eventsService.analyticsEvents.next(AnalyticsEvents.NAVIGATE_ENVIRONMENT);
    }
  }

  /**
   * Set active route by UUID or navigation
   */
  public setActiveRoute(routeUUIDOrDirection: string | ReducerDirectionType) {
    if (this.environmentsStore.getEnvironments().activeRouteUUID !== routeUUIDOrDirection) {
      if (routeUUIDOrDirection === 'next' || routeUUIDOrDirection === 'previous') {
        this.environmentsStore.update({ type: 'NAVIGATE_ROUTES', direction: routeUUIDOrDirection });
      } else {
        this.environmentsStore.update({ type: 'SET_ACTIVE_ROUTE', UUID: routeUUIDOrDirection });
      }

      this.eventsService.analyticsEvents.next(AnalyticsEvents.NAVIGATE_ROUTE);
    }
  }

  /**
   * Add a new environment and save it in the store
   */
  public addEnvironment() {
    const newEnvironment = Object.assign(
      {},
      this.environmentSchema,
      {
        uuid: uuid(),
        name: 'New environment',
        port: 3000,
        routes: [
          Object.assign(
            {},
            this.routeSchema,
            { headers: [Object.assign({}, this.routeHeadersSchema, { uuid: uuid() })] }
          )
        ],
        modifiedAt: new Date(),
        headers: [{ uuid: uuid(), key: 'Content-Type', value: 'application/json' }]
      }
    );

    this.environmentsStore.update({ type: 'ADD_ENVIRONMENT', item: newEnvironment });
    this.eventsService.analyticsEvents.next(AnalyticsEvents.CREATE_ENVIRONMENT);

    // TODO move
    this.environmentUpdateEvents.next({ environment: newEnvironment });
  }

  /**
   * Duplicate an environment, or the active environment and append it at the end of the list.
   */
  public duplicateEnvironment(environmentUUID?: string) {
    let environmentToDuplicate = this.environmentsStore.getActiveEnvironment();

    if (environmentUUID) {
      environmentToDuplicate = this.environmentsStore.getEnvironments().state.find(environment => environment.uuid === environmentUUID);
    }

    if (environmentToDuplicate) {
      // copy the environment, reset some properties and change name
      let newEnvironment: EnvironmentType = {
        ...cloneDeep(environmentToDuplicate),
        ...this.environmentResetSchema,
        name: `${environmentToDuplicate.name} (copy)`
      };

      newEnvironment = this.renewUUIDs(newEnvironment, 'environment') as EnvironmentType;

      this.environmentsStore.update({ type: 'ADD_ENVIRONMENT', item: newEnvironment });

      this.eventsService.analyticsEvents.next(AnalyticsEvents.DUPLICATE_ENVIRONMENT);

      // TODO move
      this.environmentUpdateEvents.next({ environment: newEnvironment });
    }
  }

  /**
   * Remove an environment or the current one if not environmentUUID is provided
   */
  public removeEnvironment(environmentUUID?: string) {
    const currentEnvironmentUUID = this.environmentsStore.getActiveEnvironmentUUID();

    if (!environmentUUID) {
      if (!currentEnvironmentUUID) {
        return;
      }
      environmentUUID = this.environmentsStore.getActiveEnvironmentUUID();
    }

    this.eventsService.environmentDeleted.emit(environmentUUID);

    this.environmentsStore.update({ type: 'REMOVE_ENVIRONMENT', UUID: environmentUUID });

    // TODO move this.checkEnvironmentsDuplicates();

    this.eventsService.analyticsEvents.next(AnalyticsEvents.DELETE_ENVIRONMENT);

    // TODO move
    this.environmentUpdateEvents.next({});
  }

  /**
   * Add a new route and save it in the store
   */
  public addRoute() {
    const newRoute = Object.assign(
      {},
      this.routeSchema,
      { uuid: uuid(), headers: [Object.assign({}, this.routeHeadersSchema, { uuid: uuid() })] }
    );

    this.environmentsStore.update({ type: 'ADD_ROUTE', item: newRoute });
    this.eventsService.analyticsEvents.next(AnalyticsEvents.CREATE_ROUTE);

    // TODO move
    this.environmentUpdateEvents.next({});
  }

  /**
   * Duplicate a route, or the current active route and append it at the end
   */
  public duplicateRoute(routeUUID?: string) {
    let routeToDuplicate = this.environmentsStore.getActiveRoute();

    if (routeUUID) {
      routeToDuplicate = this.environmentsStore.getActiveEnvironment().routes.find(route => route.uuid === routeUUID);
    }

    if (routeToDuplicate) {
      let newRoute = {
        ...cloneDeep(routeToDuplicate),
        duplicates: []
      };

      newRoute = this.renewUUIDs(newRoute, 'route') as RouteType;

      this.environmentsStore.update({ type: 'ADD_ROUTE', item: newRoute });

      this.eventsService.analyticsEvents.next(AnalyticsEvents.DUPLICATE_ROUTE);

      // TODO move
      this.environmentUpdateEvents.next({});
    }
  }

  /**
   * Remove a route and save
   */
  public removeRoute(routeUUID: string = this.environmentsStore.getActiveRouteUUID()) {
    this.environmentsStore.update({ type: 'REMOVE_ROUTE', UUID: routeUUID });

    // TODO move this.checkRoutesDuplicates(environment);

    this.eventsService.analyticsEvents.next(AnalyticsEvents.DELETE_ROUTE);

    /* this.environmentUpdateEvents.next({
      environment
    }); */
  }

  /**
   * Set active tab
   */
  public setActiveTab(activeTab: TabsNameType) {
    this.environmentsStore.update({ type: 'SET_ACTIVE_TAB', item: activeTab });
  }

  /**
   * Update the active environment
   */
  public updateActiveEnvironment(properties: { [key in keyof EnvironmentType]?: any }) {
    this.environmentsStore.update({ type: 'UPDATE_ENVIRONMENT', properties });
  }

  public toggleActiveEnvironment() {
    const activeEnvironment = this.environmentsStore.getActiveEnvironment();

    if (activeEnvironment.running) {
      this.serverService.stop(activeEnvironment.uuid);

      this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_STOP);

      if (activeEnvironment.needRestart) {
        this.serverService.start(activeEnvironment);
        this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_RESTART);
      }

      // if stopping or restarting, restart is not needed
      activeEnvironment.needRestart = false;
    } else {
      this.serverService.start(activeEnvironment);
      this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_START);
    }
  }

  /**
   * Build a default environment when starting the application for the first time
   */
  private buildDefaultEnvironment(): EnvironmentType {
    const defaultEnvironment: EnvironmentType = Object.assign({}, this.environmentSchema);
    defaultEnvironment.uuid = uuid(); // random uuid
    defaultEnvironment.name = 'Example';
    defaultEnvironment.headers = [Object.assign({}, this.emptyHeaderSchema, { uuid: uuid() })];

    defaultEnvironment.routes.push(Object.assign(
      {}, this.routeSchema, { uuid: uuid(), headers: [{ uuid: uuid(), key: 'Content-Type', value: 'text/plain' }] },
      { endpoint: 'answer', body: '42' }
    ));
    defaultEnvironment.routes.push(Object.assign(
      {}, this.routeSchema, { uuid: uuid(), headers: [{ uuid: uuid(), key: 'Content-Type', value: 'application/json' }] },
      {
        method: 'post',
        endpoint: 'dolphins',
        body: '{\n    "response": "So Long, and Thanks for All the Fish"\n}'
      }
    ));
    defaultEnvironment.modifiedAt = new Date();

    return defaultEnvironment;
  }

  /**
   * Check if route is duplicated and mark it
   *
   * @param environment - environment to which check the route against
   */
  private checkRoutesDuplicates(environment: EnvironmentType) {
    environment.routes.forEach((firstRoute, firstRouteIndex) => {
      const duplicatedRoutesIndexes = [];

      // extract all routes with same endpoint than current one
      const duplicatedRoutes: RouteType[] = environment.routes.filter((otherRouteItem: RouteType, otherRouteIndex: number) => {
        // ignore same route
        if (otherRouteIndex === firstRouteIndex) {
          return false;
        } else {
          // if duplicated index keep duplicated route index in an array, return the duplicated route
          if (otherRouteItem.endpoint === firstRoute.endpoint && otherRouteItem.method === firstRoute.method) {
            duplicatedRoutesIndexes.push(otherRouteIndex);
            return true;
          } else {
            return false;
          }
        }
      });

      firstRoute.duplicates = duplicatedRoutesIndexes;
    });
  }

  /**
   * Check if environments are duplicated and mark them
   */
  private checkEnvironmentsDuplicates() {
    if (this.environments) {
      this.environments.forEach((environment, environmentIndex) => {
        const duplicatedEnvironmentsIndexes = [];

        // extract all environments with same port than current one
        const duplicatedEnvironments: EnvironmentType[] = this.environments.filter((
          otherEnvironmentItem: EnvironmentType,
          otherEnvironmentIndex: number
        ) => {
          // ignore same environment
          if (otherEnvironmentIndex === environmentIndex) {
            return false;
          } else {
            // if duplicated index keep duplicated route index in an array, return the duplicated route
            if (otherEnvironmentItem.port === environment.port) {
              duplicatedEnvironmentsIndexes.push(otherEnvironmentIndex);
              return true;
            } else {
              return false;
            }
          }
        });

        environment.duplicates = duplicatedEnvironmentsIndexes;
      });
    }
  }

  /**
   * Clean environments before saving
   *
   */
  private cleanBeforeSave() {
    const environmentsCopy: EnvironmentsType = this.environments.map((environment: EnvironmentType): EnvironmentType => {
      const environmentCopy = cloneDeep(environment);

      // remove some items
      delete environmentCopy.running;
      delete environmentCopy.startedAt;
      delete environmentCopy.needRestart;

      return environmentCopy;
    });

    return environmentsCopy;
  }

  /**
   * Migrate data after loading if needed.
   * This cumulate all versions migration
   *
   * @param environments - environments to migrate
   */
  private migrateData(environments: EnvironmentsType) {
    let wasUpdated = false;
    let lastMigrationId;

    Migrations.forEach(migration => {
      if (migration.id > this.settingsService.settings.lastMigration) {
        lastMigrationId = migration.id;

        environments.forEach(environment => migration.migrationFunction(environment));
        wasUpdated = true;
      }
    });

    if (wasUpdated) {
      // if a migration was played immediately save
      this.environmentUpdateEvents.next({});

      // save last migration in the settings
      this.settingsService.settings.lastMigration = lastMigrationId;
      this.settingsService.settingsUpdateEvents.next(this.settingsService.settings);
    }

    return environments;
  }

  /**
   * Renew all environments UUIDs
   *
   * @param data
   * @param subject
   */
  private renewUUIDs(data: EnvironmentsType | EnvironmentType | RouteType, subject: DataSubjectType) {
    if (subject === 'full') {
      (data as EnvironmentsType).forEach(environment => {
        this.renewUUIDs(environment, 'environment');
      });
    } else if (subject === 'environment') {
      (data as EnvironmentType).uuid = uuid();
      (data as EnvironmentType).headers.forEach(header => {
        header.uuid = uuid();
      });
      (data as EnvironmentType).routes.forEach(route => {
        this.renewUUIDs(route, 'route');
      });
    } else if (subject === 'route') {
      (data as RouteType).uuid = uuid();
      (data as RouteType).headers.forEach(header => {
        header.uuid = uuid();
      });
    }

    return data;
  }

  public findEnvironmentIndex(environmentUUID: string): number {
    return this.environments.findIndex(environment => environment.uuid === environmentUUID);
  }

  public findRouteIndex(environment: EnvironmentType, routeUUID: string): number {
    return environment.routes.findIndex(route => route.uuid === routeUUID);
  }

  /**
   * Export all envs in a json file
   */
  public exportAllEnvironments() {
    this.dialog.showSaveDialog(this.BrowserWindow.getFocusedWindow(), { filters: [{ name: 'JSON', extensions: ['json'] }] }, (path) => {
      // reset environments before exporting
      const dataToExport = cloneDeep(this.environments);
      dataToExport.forEach(environment => {
        Object.assign(environment, this.environmentResetSchema);
      });

      try {
        fs.writeFile(path, this.dataService.wrapExport(dataToExport, 'full'), (error) => {
          if (error) {
            this.alertService.showAlert('error', Errors.EXPORT_ERROR);
          } else {
            this.alertService.showAlert('success', Messages.EXPORT_SUCCESS);

            this.eventsService.analyticsEvents.next(AnalyticsEvents.EXPORT_FILE);
          }
        });
      } catch (error) {
        this.alertService.showAlert('error', Errors.EXPORT_ERROR);
      }
    });
  }

  /**
   * Export an environment to the clipboard
   *
   * @param environmentIndex
   */
  public exportEnvironmentToClipboard(environmentIndex: number) {
    try {
      // reset environment before exporting
      clipboard.writeText(this.dataService.wrapExport({ ...cloneDeep(this.environments[environmentIndex]), ...this.environmentResetSchema }, 'environment'));
      this.alertService.showAlert('success', Messages.EXPORT_ENVIRONMENT_CLIPBOARD_SUCCESS);
      this.eventsService.analyticsEvents.next(AnalyticsEvents.EXPORT_CLIPBOARD);
    } catch (error) {
      this.alertService.showAlert('error', Errors.EXPORT_ENVIRONMENT_CLIPBOARD_ERROR);
    }
  }

  /**
   * Export an environment to the clipboard
   *
   * @param environmentIndex
   * @param routeIndex
   */
  public exportRouteToClipboard(environmentIndex: number, routeIndex: number) {
    try {
      clipboard.writeText(this.dataService.wrapExport(this.environments[environmentIndex].routes[routeIndex], 'route'));
      this.alertService.showAlert('success', Messages.EXPORT_ROUTE_CLIPBOARD_SUCCESS);
      this.eventsService.analyticsEvents.next(AnalyticsEvents.EXPORT_CLIPBOARD);
    } catch (error) {
      this.alertService.showAlert('error', Errors.EXPORT_ROUTE_CLIPBOARD_ERROR);
    }
  }

  /**
   * Import an environment / route from clipboard
   * Append environment, append route in currently selected environment
   *
   * @param currentEnvironment
   */
  public importFromClipboard(currentEnvironment: CurrentEnvironmentType) {
    let importData: ExportType;
    try {
      importData = JSON.parse(clipboard.readText());

      // verify data checksum
      if (!this.dataService.verifyImportChecksum(importData)) {
        this.alertService.showAlert('error', Errors.IMPORT_CLIPBOARD_WRONG_CHECKSUM);
        return;
      }

      if (importData.subject === 'environment') {
        importData.data = this.renewUUIDs(importData.data as EnvironmentType, 'environment');
        this.environments.push(importData.data as EnvironmentType);
        this.environments = this.migrateData(this.environments);

        // if only one environment ask for selection of the one just created
        if (this.environments.length === 1) {
          this.selectEnvironment$.next(0);
        }

        this.alertService.showAlert('success', Messages.IMPORT_ENVIRONMENT_CLIPBOARD_SUCCESS);
      } else if (importData.subject === 'route') {
        let currentEnvironmentIndex: number;
        // if no current environment create one and ask for selection
        if (this.environments.length === 0) {
          const newEnvironmentIndex = this.addEnvironment();

          this.selectEnvironment$.next(0);
          this.environments[0].routes = [];

          currentEnvironmentIndex = 0;
        } else {
          currentEnvironmentIndex = currentEnvironment.index;
        }

        importData.data = this.renewUUIDs(importData.data as RouteType, 'route');
        this.environments[currentEnvironmentIndex].routes.push(importData.data as RouteType);
        this.environments = this.migrateData(this.environments);

        this.alertService.showAlert('success', Messages.IMPORT_ROUTE_CLIPBOARD_SUCCESS);
      }

      this.environmentUpdateEvents.next({
        environment: (currentEnvironment) ? currentEnvironment.environment : null
      });

      this.eventsService.analyticsEvents.next(AnalyticsEvents.IMPORT_CLIPBOARD);
    } catch (error) {
      if (!importData) {
        this.alertService.showAlert('error', Errors.IMPORT_CLIPBOARD_WRONG_CHECKSUM);
        return;
      }

      if (importData.subject === 'environment') {
        this.alertService.showAlert('error', Errors.IMPORT_ENVIRONMENT_CLIPBOARD_ERROR);
      } else if (importData.subject === 'route') {
        this.alertService.showAlert('error', Errors.IMPORT_ROUTE_CLIPBOARD_ERROR);
      }
    }
  }

  /**
   * Import a json environments file in Mockoon's format.
   * Verify checksum and migrate data.
   *
   * Append imported envs to the env array.
   *
   * @param currentEnvironment
   */
  public importEnvironmentsFile(callback: Function) {
    this.dialog.showOpenDialog(this.BrowserWindow.getFocusedWindow(), { filters: [{ name: 'JSON', extensions: ['json'] }] }, (file) => {
      if (file && file[0]) {
        fs.readFile(file[0], 'utf-8', (error, fileContent) => {
          if (error) {
            this.alertService.showAlert('error', Errors.IMPORT_ERROR);
          } else {
            const importData: ExportType = JSON.parse(fileContent);

            // verify data checksum
            if (!this.dataService.verifyImportChecksum(importData)) {
              this.alertService.showAlert('error', Errors.IMPORT_FILE_WRONG_CHECKSUM);
              return;
            }

            importData.data = this.renewUUIDs(importData.data as EnvironmentsType, 'full');

            this.environments.push(...(importData.data as EnvironmentsType));

            // play migrations
            this.environments = this.migrateData(this.environments);

            this.environmentUpdateEvents.next({});

            this.alertService.showAlert('success', Messages.IMPORT_SUCCESS);

            this.eventsService.analyticsEvents.next(AnalyticsEvents.IMPORT_FILE);

            callback();
          }
        });
      }
    });
  }

  /**
   * Return the route content type or environment content type if any
   *
   * @param environment
   * @param route
   */
  public getRouteContentType(environment: EnvironmentType, route: RouteType) {
    const routeContentType = route.headers.find(header => header.key === 'Content-Type');

    if (routeContentType && routeContentType.value) {
      return routeContentType.value;
    }

    const environmentContentType = environment.headers.find(header => header.key === 'Content-Type');

    if (environmentContentType && environmentContentType.value) {
      return environmentContentType.value;
    }

    return '';
  }

  /**
   * Check if active environment has headers
   */
  public hasEnvironmentHeaders() {
    const activeEnvironment = this.environmentsStore.getActiveEnvironment();
    return activeEnvironment && activeEnvironment.headers.some(header => !!header.key);
  }

  /**
   * Add CORS headers to environment headers if not already exists
   *
   * @param environment
   */
  public setEnvironmentCORSHeaders(environment: EnvironmentType) {
    CORSHeaders.forEach(CORSHeader => {
      const headerExists = this.findHeaderByName(environment.headers, CORSHeader.key);
      // only write header if wasn't found or has no value
      if (!headerExists) {
        environment.headers.push({ uuid: uuid(), key: CORSHeader.key, value: CORSHeader.value });
      } else if (!headerExists.value) {
        headerExists.value = CORSHeader.value;
      }
    });
  }

  /**
   * Find a header by its key
   *
   * @param headers
   * @param name
   */
  private findHeaderByName(headers: HeaderType[], name: string) {
    return headers.find(header => header.key === name);
  }

  /**
   * Calculate the total number of routes
   *
   */
  private updateRoutesTotal() {
    this.routesTotal = this.environments.reduce((total, environment) => {
      return total + environment.routes.length;
    }, 0);
  }
}
