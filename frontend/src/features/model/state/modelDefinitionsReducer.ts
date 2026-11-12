import type { ModelDefinitionsState } from '../domain/types';

export type ModelDefinitionsAction = {
  type: 'setState';
  payload: ModelDefinitionsState;
};

export function modelDefinitionsReducer(_state: ModelDefinitionsState, action: ModelDefinitionsAction): ModelDefinitionsState {
  switch (action.type) {
    case 'setState':
      return action.payload;
    default:
      return _state;
  }
}
