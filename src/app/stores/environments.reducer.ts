import { EnvironmentsStoreType } from 'src/app/stores/environments.store';

export type ReducerDirectionType = 'next' | 'previous';
export type ReducerActionType = {
  type: 'SET_ACTIVE_TAB' | 'SET_ACTIVE_ENVIRONMENT' | 'NAVIGATE_ENVIRONMENTS' | 'ADD_ENVIRONMENT' | 'REMOVE_ENVIRONMENT' | 'SET_ACTIVE_ROUTE' | 'NAVIGATE_ROUTES' | 'ADD_ROUTE' | 'REMOVE_ROUTE';
  UUID?: string;
  item?: any;
  direction?: ReducerDirectionType;
};

export function environmentReducer(
  environmentsState: EnvironmentsStoreType,
  action: ReducerActionType
): EnvironmentsStoreType {
  switch (action.type) {
    case 'SET_ACTIVE_TAB': {
      return {
        ...environmentsState,
        activeTab: action.item,
        state: environmentsState.state
      };
    }

    case 'SET_ACTIVE_ENVIRONMENT': {
      if (action.UUID !== environmentsState.activeEnvironmentUUID) {
        const activeEnvironment = action.UUID ? environmentsState.state.find(environment => environment.uuid === action.UUID) : environmentsState.state[0];

        return {
          ...environmentsState,
          activeEnvironmentUUID: action.UUID ? action.UUID : activeEnvironment.uuid,
          activeRouteUUID: (activeEnvironment.routes.length) ? activeEnvironment.routes[0].uuid : null,
          activeTab: 'RESPONSE',
          state: environmentsState.state
        };
      }
      return environmentsState;
    }

    case 'NAVIGATE_ENVIRONMENTS': {
      const activeEnvironmentIndex = environmentsState.state.findIndex(environment => environment.uuid === environmentsState.activeEnvironmentUUID);

      let newEnvironment;

      if (action.direction === 'next' && activeEnvironmentIndex < environmentsState.state.length - 1) {
        newEnvironment = environmentsState.state[activeEnvironmentIndex + 1];
      } else if (action.direction === 'previous' && activeEnvironmentIndex > 0) {
        newEnvironment = environmentsState.state[activeEnvironmentIndex - 1];
      } else {
        return environmentsState;
      }

      return {
        ...environmentsState,
        activeEnvironmentUUID: newEnvironment.uuid,
        activeRouteUUID: (newEnvironment.routes.length) ? newEnvironment.routes[0].uuid : null,
        activeTab: 'RESPONSE',
        state: environmentsState.state
      };
    }

    case 'SET_ACTIVE_ROUTE': {
      if (action.UUID !== environmentsState.activeRouteUUID) {
        return {
          ...environmentsState,
          activeRouteUUID: action.UUID,
          activeTab: 'RESPONSE',
          state: environmentsState.state
        };
      } else {
        return environmentsState;
      }
    }

    case 'NAVIGATE_ROUTES': {
      const activeEnvironment = environmentsState.state.find(environment => environment.uuid === environmentsState.activeEnvironmentUUID);
      const activeRouteIndex = activeEnvironment.routes.findIndex(route => route.uuid === environmentsState.activeRouteUUID);

      let newRoute;

      if (action.direction === 'next' && activeRouteIndex < activeEnvironment.routes.length - 1) {
        newRoute = activeEnvironment.routes[activeRouteIndex + 1];
      } else if (action.direction === 'previous' && activeRouteIndex > 0) {
        newRoute = activeEnvironment.routes[activeRouteIndex - 1];
      } else {
        return environmentsState;
      }

      return {
        ...environmentsState,
        activeRouteUUID: newRoute.uuid,
        activeTab: 'RESPONSE',
        state: environmentsState.state
      };
    }

    case 'ADD_ENVIRONMENT': {
      return {
        ...environmentsState,
        activeEnvironmentUUID: action.item.uuid,
        activeRouteUUID: action.item.routes[0].uuid,
        activeTab: 'RESPONSE',
        state: [
          ...environmentsState.state,
          action.item
        ]
      };
    }

    case 'REMOVE_ENVIRONMENT': {
      const newState = environmentsState.state.filter(environment => environment.uuid !== action.UUID);

      if (environmentsState.activeEnvironmentUUID === action.UUID) {
        if (newState.length) {
          return {
            ...environmentsState,
            activeEnvironmentUUID: newState[0].uuid,
            activeRouteUUID: (newState[0].routes.length) ? newState[0].routes[0].uuid : null,
            state: newState
          };
        } else {
          return {
            ...environmentsState,
            activeEnvironmentUUID: null,
            activeRouteUUID: null,
            state: newState
          };
        }
      } else {
        return {
          ...environmentsState,
          state: newState
        };
      }
    }

    case 'REMOVE_ROUTE': {
      const activeEnvironment = environmentsState.state.find(environment => environment.uuid === environmentsState.activeEnvironmentUUID);
      const newRoutes = activeEnvironment.routes.filter(route => route.uuid !== action.UUID);
      const newState = environmentsState.state.map(environment => {
        if (environment.uuid === environmentsState.activeEnvironmentUUID) {
          return {
            ...environment,
            routes: newRoutes
          };
        }
        return environment;
      });

      if (environmentsState.activeRouteUUID === action.UUID) {
        if (newRoutes.length) {
          return {
            ...environmentsState,
            activeRouteUUID: newRoutes[0].uuid,
            state: newState
          };
        } else {
          return {
            ...environmentsState,
            activeRouteUUID: null,
            activeTab: 'ENV_SETTINGS',
            state: newState
          };
        }
      } else {
        return {
          ...environmentsState,
          state: newState
        };
      }
    }

    case 'ADD_ROUTE': {
      // only add a route if there is at least one environment
      if (environmentsState.state.length > 0) {
        return {
          ...environmentsState,
          activeRouteUUID: action.item.uuid,
          activeTab: 'RESPONSE',
          state: environmentsState.state.map(environment => {
            if (environment.uuid === environmentsState.activeEnvironmentUUID) {
              return {
                ...environment,
                routes: [...environment.routes, action.item]
              };
            }
            return environment;
          })
        };
      }
      return environmentsState;
    }

    default:
      return environmentsState;
  }
}
