import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { NgbTooltipConfig } from '@ng-bootstrap/ng-bootstrap';
import 'brace';
import 'brace/ext/searchbox';
import 'brace/index';
import 'brace/mode/css';
import 'brace/mode/html.js';
import 'brace/mode/json.js';
import 'brace/mode/text.js';
import 'brace/mode/xml.js';
import { ipcRenderer, remote, shell } from 'electron';
import * as mimeTypes from 'mime-types';
import { DragulaService } from 'ng2-dragula';
import * as path from 'path';
import { Observable } from 'rxjs';
import { distinctUntilKeyChanged, filter } from 'rxjs/operators';
import { ContextMenuItemPayload } from 'src/app/components/context-menu.component';
import { Config } from 'src/app/config';
import { AnalyticsEvents } from 'src/app/enums/analytics-events.enum';
import { Alert, AlertService } from 'src/app/services/alert.service';
import { AnalyticsService } from 'src/app/services/analytics.service';
import { AuthService } from 'src/app/services/auth.service';
import { EnvironmentsService } from 'src/app/services/environments.service';
import { ContextMenuEventType, EventsService } from 'src/app/services/events.service';
import { ServerService } from 'src/app/services/server.service';
import { UpdateService } from 'src/app/services/update.service';
import { ReducerDirectionType } from 'src/app/stores/environments.reducer';
import { EnvironmentsStore, EnvironmentsStoreType, TabsNameType } from 'src/app/stores/environments.store';
import { DataSubjectType } from 'src/app/types/data.type';
import { CurrentEnvironmentType, EnvironmentsType, EnvironmentType } from 'src/app/types/environment.type';
import { headerNames, headerValues, methods, mimeTypesWithTemplating, RouteType, statusCodes, statusCodesExplanation } from 'src/app/types/route.type';
import '../assets/custom_theme.js';
const platform = require('os').platform();
const appVersion = require('../../package.json').version;
const arrayMove = require('array-move');

/**
 * DO NOT FORGET:
 * - add MousewheelUpdate on route latency input
 */


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements OnInit {
  @ViewChild('routesMenu') private routesMenu: ElementRef;
  @ViewChild('environmentsMenu') private environmentsMenu: ElementRef;
  public environments: EnvironmentsType;
  public currentEnvironment: CurrentEnvironmentType = null;
  public currentRoute: { route: RouteType, index: number } = null;
  public methods = methods;
  public statusCodes = statusCodes;
  public statusCodesExplanation = statusCodesExplanation;
  public saving = false;
  public editorConfig: any = {
    options: {
      fontSize: '1rem',
      wrap: 'free',
      showPrintMargin: false,
      tooltipFollowsMouse: false,
      useWorker: false
    },
    mode: 'json',
    theme: 'custom_theme'
  };
  public alerts: Alert[];
  public updateAvailable = false;
  public platform = platform;
  public headerNamesList = headerNames;
  public headerValuesList = headerValues;
  public getRouteContentType = this.environmentsService.getRouteContentType;
  public hasEnvironmentHeaders = this.environmentsService.hasEnvironmentHeaders;
  public clearEnvironmentLogsTimeout: NodeJS.Timer;
  public environmentLogs = this.serverService.environmentsLogs;
  public appVersion = appVersion;

  public environments$: Observable<EnvironmentsStoreType>;
  public activeEnvironment$: Observable<EnvironmentType>;
  public activeRoute$: Observable<RouteType>;
  public activeTab$: Observable<TabsNameType>;
  public activeEnvironmentForm: FormGroup;

  private settingsModalOpened = false;
  private dialog = remote.dialog;
  private BrowserWindow = remote.BrowserWindow;
  private dragDeadzone = 10;
  private lastMouseDownPosition: { x: number; y: number };

  constructor(
    public environmentsService: EnvironmentsService,
    private serverService: ServerService,
    private alertService: AlertService,
    private updateService: UpdateService,
    private authService: AuthService,
    private eventsService: EventsService,
    private config: NgbTooltipConfig,
    private dragulaService: DragulaService,
    private analyticsService: AnalyticsService,
    private environmentsStore: EnvironmentsStore,
    private formBuilder: FormBuilder
  ) {
    // tooltip config
    this.config.container = 'body';
    this.config.placement = 'bottom';

    // set listeners on main process messages
    ipcRenderer.on('keydown', (event, data) => {
      switch (data.action) {
        case 'NEW_ENVIRONMENT':
          this.addEnvironment();
          break;
        case 'NEW_ROUTE':
          this.addRoute();
          break;
        case 'START_ENVIRONMENT':
          this.toggleEnvironment();
          break;
        case 'DUPLICATE_ENVIRONMENT':
          this.duplicateEnvironment();
          break;
        case 'DUPLICATE_ROUTE':
          this.duplicateRoute();
          break;
        case 'DELETE_ENVIRONMENT':
          this.removeEnvironment();
          break;
        case 'DELETE_ROUTE':
          this.removeRoute();
          break;
        case 'PREVIOUS_ENVIRONMENT':
          this.selectEnvironment('previous');
          break;
        case 'NEXT_ENVIRONMENT':
          this.selectEnvironment('next');
          break;
        case 'PREVIOUS_ROUTE':
          this.selectRoute('previous');
          break;
        case 'NEXT_ROUTE':
          this.selectRoute('next');
          break;
        case 'OPEN_SETTINGS':
          if (!this.settingsModalOpened) {
            this.settingsModalOpened = true;
            this.eventsService.settingsModalEvents.emit(true);
          }
          break;
        case 'IMPORT_FILE':
          this.environmentsService.importEnvironmentsFile(() => {
            if (!this.currentEnvironment) {
              this.selectEnvironmentOLD(0);
            }
          });
          break;
        case 'IMPORT_CLIPBOARD':
          this.environmentsService.importFromClipboard(this.currentEnvironment);
          break;
        case 'EXPORT_FILE':
          this.environmentsService.exportAllEnvironments();
          break;
      }
    });
  }

  ngOnInit() {
    this.activeEnvironmentForm = this.formBuilder.group({
      name: [''],
      port: [''],
      endpointPrefix: [''],
      latency: ['']
    });

    // send new activeEnvironmentForm values to the store
    this.activeEnvironmentForm.valueChanges.subscribe(newProperties => {
      this.environmentsService.updateActiveEnvironment(newProperties);
    });

    this.analyticsService.init();

    // auth anonymously through firebase
    this.authService.auth();

    // send first GA requests when env are ready TODO move somewhere else ?
    this.eventsService.analyticsEvents.next(AnalyticsEvents.PAGEVIEW);
    this.eventsService.analyticsEvents.next(AnalyticsEvents.APPLICATION_START);

    this.environments$ = this.environmentsStore.selectEnvironments();
    this.activeEnvironment$ = this.environmentsStore.selectActiveEnvironment();
    this.activeRoute$ = this.environmentsStore.selectActiveRoute();
    this.activeTab$ = this.environmentsStore.selectActiveTab();

    // subscribe to active environment changes to reset the form
    this.activeEnvironment$.pipe(
      filter(environment => !!environment),
      distinctUntilKeyChanged('uuid')
    ).subscribe(activeEnvironment => {
      this.activeEnvironmentForm.setValue({
        name: activeEnvironment.name,
        port: activeEnvironment.port,
        endpointPrefix: activeEnvironment.endpointPrefix,
        latency: activeEnvironment.latency
      });
    });

    this.environmentsService.selectEnvironment$.subscribe((environmentIndex: number) => {
      this.selectEnvironmentOLD(environmentIndex);
    });

    this.alerts = this.alertService.alerts;

    // subscribe to update events
    this.updateService.updateAvailable.subscribe(() => {
      this.updateAvailable = true;
    });

    this.initDragMonitoring();
  }

  /**
   * Prevent dragging of envs/routes for small moves
   *
   * @param event
   */
  @HostListener('mousedown', ['$event']) onMouseDown(event: MouseEvent) {
    this.lastMouseDownPosition = { x: event.clientX, y: event.clientY };
  }
  @HostListener('mousemove', ['$event']) onMouseMove(event: MouseEvent) {
    // if left mouse button pressed
    if (this.lastMouseDownPosition && event.buttons === 1) {
      const delta = Math.sqrt(
        Math.pow(event.clientX - this.lastMouseDownPosition.x, 2) +
        Math.pow(event.clientY - this.lastMouseDownPosition.y, 2)
      );

      if (delta < this.dragDeadzone) {
        event.stopPropagation();
      }
    }
  }

  /**
   * Trigger env/route saving and re-selection when draging active route/env
   */
  public initDragMonitoring() {
    // on drop reselect if we moved a selected env/route
    this.dragulaService.dropModel().subscribe((movedItem) => {
      if (movedItem.name === 'environmentsContainer') {
        arrayMove.mut(this.environments, movedItem.sourceIndex, movedItem.targetIndex);

        const selectedEnvironmentIndex = this.environmentsService.findEnvironmentIndex(this.currentEnvironment.environment.uuid);
        this.selectEnvironmentOLD(selectedEnvironmentIndex);

        this.environmentUpdated('envReorder', true);
      } else if (movedItem.name === 'routesContainer') {
        arrayMove.mut(this.currentEnvironment.environment.routes, movedItem.sourceIndex, movedItem.targetIndex);

        const selectedRouteIndex = this.environmentsService.findRouteIndex(this.currentEnvironment.environment, this.currentRoute.route.uuid);
        // TODO using new move reducer action this.selectRouteOLD(selectedRouteIndex);

        this.environmentUpdated('routeReorder', true);
      }
    });
  }
  /**
   * Toggle active environment running state (start/stop)
   */
  public toggleEnvironment() {
    this.environmentsService.toggleActiveEnvironment();
    /* if (environment) {
      if (environment.running) {
        this.serverService.stop(environment.uuid);

        this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_STOP);

        if (environment.needRestart) {
          this.serverService.start(environment);
          this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_RESTART);
        }

        // if stopping or restarting, restart is not needed
        environment.needRestart = false;
      } else {
        this.serverService.start(environment);
        this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_START);
      }
    } */
  }

  /**
   * Set the active environment
   */
  public selectEnvironment(environmentUUIDOrDirection: string | ReducerDirectionType) {
    this.environmentsService.setActiveEnvironment(environmentUUIDOrDirection);

    // auto scroll routes to top when navigating environments
    if (this.routesMenu) {
      this.routesMenu.nativeElement.scrollTop = 0;
    }
  }

  public selectEnvironmentOLD(environmentUUID: number) {
    // check if selection exists
    if (environmentUUID >= 0 && environmentUUID <= (this.environments.length - 1)) {
      this.currentEnvironment = { environment: this.environments[environmentUUID], index: environmentUUID };

      // auto scroll routes to top when navigating environments
      if (this.routesMenu) {
        this.routesMenu.nativeElement.scrollTop = 0;
      }

      this.eventsService.analyticsEvents.next(AnalyticsEvents.NAVIGATE_ENVIRONMENT);
    }
  }

  /**
   * Set the application active tab
   */
  public setActiveTab(tabName: TabsNameType) {
    this.environmentsService.setActiveTab(tabName);
  }

  public clearEnvironmentLogs(currentEnvironment: CurrentEnvironmentType) {
    if (this.clearEnvironmentLogsTimeout) {
      this.serverService.clearEnvironmentLogs(currentEnvironment.environment.uuid);
      clearTimeout(this.clearEnvironmentLogsTimeout);
      this.clearEnvironmentLogsTimeout = undefined;
    } else {
      this.clearEnvironmentLogsTimeout = setTimeout(() => {
        this.clearEnvironmentLogsTimeout = undefined;
      }, 4000);
    }
  }

  /**
   * Select a route by UUID, or the first route if no UUID is present
   */
  public selectRoute(routeUUIDOrDirection: string | ReducerDirectionType) {
    this.environmentsService.setActiveRoute(routeUUIDOrDirection);

    this.changeEditorSettings();
  }

  /**
   * Create a new environment. Append at the end of the list.
   */
  public addEnvironment() {
    this.environmentsService.addEnvironment();

    this.scrollToBottom(this.environmentsMenu.nativeElement);
  }

  /**
   * Duplicate an environment
   */
  public duplicateEnvironment(environmentUUID?: string) {
    this.environmentsService.duplicateEnvironment(environmentUUID);

    this.scrollToBottom(this.environmentsMenu.nativeElement);
  }

  /**
   * Create a new route in the current environment. Append at the end of the list
   */
  public addRoute() {
    this.environmentsService.addRoute();

    if (this.routesMenu) {
      this.scrollToBottom(this.routesMenu.nativeElement);
    }
  }

  /**
   * Duplicate a route
   */
  public duplicateRoute(routeUUID?: string) {
    this.environmentsService.duplicateRoute(routeUUID);

    this.scrollToBottom(this.routesMenu.nativeElement);
  }

  public handleSettingsModalClosed() {
    this.settingsModalOpened = false;
  }

  /**
   * Function getting called each time a field is updated
   *
   * @param fieldUpdated - name of the update field
   * @param propagate - should propagate event to env service
   */
  public environmentUpdated(fieldUpdated: string = '', propagate = true) {
    // TODO move this in store / or in form change subs


    const restartNotNeeded = ['name', 'envLatency', 'routeLatency', 'statusCode', 'file', 'routeHeaders', 'environmentHeaders', 'body', 'envReorder', 'fileSendAsBody', 'documentation'];
    this.currentEnvironment.environment.modifiedAt = new Date();

    // restart is not needed for some fields
    if (!restartNotNeeded.includes(fieldUpdated)) {
      if (this.currentEnvironment.environment.running) {
        this.currentEnvironment.environment.needRestart = this.currentEnvironment.environment.modifiedAt > this.currentEnvironment.environment.startedAt;
      }
    }

    if (fieldUpdated === 'routeHeaders' || fieldUpdated === 'environmentHeaders') {
      this.changeEditorSettings();
    }

    if (propagate) {
      this.environmentsService.environmentUpdateEvents.next({
        environment: this.currentEnvironment.environment
      });
    }
  }

  /**
   * Remove route and navigate depending on remaining routes
   */
  private removeRoute(routeUUID?: string) {
    // TODO this.environmentUpdated('removeRoute', false);

    this.environmentsService.removeRoute(routeUUID);
  }

  /**
   * Remove environment and navigate depending on remaining environments
   */
  private removeEnvironment(environmentUUID?: string) {
    this.environmentsService.removeEnvironment(environmentUUID);
  }

  /**
   * Open GET routes in the browser
   */
  public openRouteInBrowser() {
    if (this.currentEnvironment.environment.running) {
      let routeUrl = ((this.currentEnvironment.environment.https) ? 'https://' : 'http://') + 'localhost:' + this.currentEnvironment.environment.port + '/';

      if (this.currentEnvironment.environment.endpointPrefix) {
        routeUrl += this.currentEnvironment.environment.endpointPrefix + '/';
      }

      routeUrl += this.currentRoute.route.endpoint;

      shell.openExternal(routeUrl);

      this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_ROUTE_IN_BROWSER);
    }
  }

  /**
   * Open file browsing dialog
   */
  public browseFiles() {
    this.dialog.showOpenDialog(this.BrowserWindow.getFocusedWindow(), {}, (file) => {
      if (file && file[0]) {
        this.updateRouteFile(file[0]);
      }
    });
  }

  /**
   * Monitor file path input changes
   *
   * @param filePath
   */
  public onFileInputChange(filePath: string) {
    if (!filePath) {
      this.deleteFile();

      return;
    }
    this.updateRouteFile(filePath);
  }

  /**
   * Update the route file object from a path
   *
   * @param filePath
   */
  private updateRouteFile(filePath: string) {
    this.currentRoute.route.file = {
      ...this.currentRoute.route.file,
      path: filePath,
      filename: path.basename(filePath),
      mimeType: mimeTypes.lookup(filePath)
    };

    this.environmentUpdated('file');
  }

  public deleteFile() {
    this.currentRoute.route.file = null;
    this.environmentUpdated('file');
  }

  /**
   * Pass remove event to alert service
   */
  public removeAlert(alertId: string) {
    this.alertService.removeAlert(alertId);
  }

  public isValidURL(URL: string) {
    return this.serverService.isValidURL(URL);
  }

  public openFeedbackLink() {
    shell.openExternal(Config.feedbackLink);

    this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_FEEDBACK);
  }

  public openChangelogModal() {
    this.eventsService.changelogModalEvents.next(true);

    this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_RELEASE);
  }

  public openWikiLink(linkName: string) {
    shell.openExternal(Config.wikiLinks[linkName]);

    this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_WIKI);
  }

  public applyUpdate() {
    this.updateService.applyUpdate();

    this.eventsService.analyticsEvents.next(AnalyticsEvents.LINK_APPLY_UPDATE);
  }

  /**
   * Set editor mode depending on content type
   */
  private changeEditorSettings() {
    /* const contentType = this.environmentsService.getRouteContentType(
      this.environmentsStore.getActiveEnvironment(),
      this.environmentsStore.getActiveRoute()
    );

    if (contentType === 'application/json') {
      this.editorConfig.mode = 'json';
    } else if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
      this.editorConfig.mode = 'html';
    } else if (contentType === 'application/xml') {
      this.editorConfig.mode = 'xml';
    } else if (contentType === 'text/css') {
      this.editorConfig.mode = 'css';
    } else {
      this.editorConfig.mode = 'text';
    } */
  }

  /**
   * Show and position the context menu
   *
   * @param event - click event
   */
  public navigationContextMenu(subject: DataSubjectType, subjectUUID: string, event: any) {
    // if right click display context menu
    if (event && event.which === 3) {
      const menu: ContextMenuEventType = {
        event: event,
        items: [
          {
            payload: {
              subject,
              action: 'duplicate',
              subjectUUID
            },
            label: 'Duplicate ' + subject,
            icon: 'content_copy'
          },
          {
            payload: {
              subject,
              action: 'export',
              subjectUUID
            },
            label: 'Copy to clipboard (JSON)',
            icon: 'assignment'
          },
          {
            payload: {
              subject,
              action: 'delete',
              subjectUUID
            },
            label: 'Delete ' + subject,
            icon: 'delete',
            confirm: {
              icon: 'error',
              label: 'Confirm deletion'
            },
            confirmColor: 'text-danger'
          }
        ]
      };

      if (subject === 'environment') {
        menu.items.unshift(
          {
            payload: {
              subject,
              action: 'env_logs',
              subjectUUID
            },
            label: 'Environment logs',
            icon: 'history'
          },
          {
            payload: {
              subject,
              action: 'env_settings',
              subjectUUID
            },
            label: 'Environment settings',
            icon: 'settings',
            separator: true
          });
      }
      this.eventsService.contextMenuEvents.emit(menu);
    }
  }

  /**
   * Handle navigation context menu item click
   *
   * @param payload
   */
  public navigationContextMenuItemClicked(payload: ContextMenuItemPayload) {
    switch (payload.action) {
      case 'env_logs':
        if (payload.subjectUUID !== this.environmentsStore.getActiveEnvironmentUUID()) {
          this.selectEnvironment(payload.subjectUUID);
        }
        this.setActiveTab('ENV_LOGS');
        break;
      case 'env_settings':
        if (payload.subjectUUID !== this.environmentsStore.getActiveEnvironmentUUID()) {
          this.selectEnvironment(payload.subjectUUID);
        }
        this.setActiveTab('ENV_SETTINGS');
        break;
      case 'duplicate':
        if (payload.subject === 'route') {
          this.duplicateRoute(payload.subjectUUID);
        } else if (payload.subject === 'environment') {
          this.duplicateEnvironment(payload.subjectUUID);
        }
        break;
      /*case 'export':
        this.exportToClipboard(payload.subject, payload.subjectUUID);
        break;  */
      case 'delete':
        if (payload.subject === 'route') {
          this.removeRoute(payload.subjectUUID);
        } else if (payload.subject === 'environment') {
          this.removeEnvironment(payload.subjectUUID);
        }
        break;
    }
  }

  /**
   * Export an environment to the clipboard
   *
   * @param subject
   * @param subjectIndex
   */
  public exportToClipboard(subject: DataSubjectType, subjectIndex: number) {
    if (subject === 'environment') {
      this.environmentsService.exportEnvironmentToClipboard(subjectIndex);
    } else if (subject === 'route') {
      this.environmentsService.exportRouteToClipboard(this.currentEnvironment.index, subjectIndex);
    }
  }

  /**
   * Check if selected file's mime type supports templating
   */
  public fileSupportsTemplating(): boolean {
    return mimeTypesWithTemplating.indexOf(this.currentRoute.route.file.mimeType) > -1;
  }

  /**
   * Check if route has query params
   */
  public routeHasQueryParams(): boolean {
    const endpoint = this.currentRoute.route.endpoint;

    if (endpoint) {
      const queryStringMatch = endpoint.match(/\?.*=/ig);

      return queryStringMatch && queryStringMatch.length > 0;
    }

    return false;
  }

  /**
   * Scroll to bottom of an element
   *
   * @param element
   */
  public scrollToBottom(element: Element) {
    setTimeout(() => {
      element.scrollTop = element.scrollHeight;
    });
  }

  public addCORSHeadersToEnvironment() {
    this.environmentsService.setEnvironmentCORSHeaders(this.currentEnvironment.environment);
  }
}
