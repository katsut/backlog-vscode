// Essential types for backlog-vscode extension
// Entity types are directly imported from backlog-js where needed

import { Backlog } from 'backlog-js';

// Service state types for better type safety
export interface UninitializedBacklogService {
  readonly state: 'uninitialized';
  readonly error?: Error;
}

export interface InitializedBacklogService {
  readonly state: 'initialized';
  readonly backlog: Backlog;
  readonly host: string;
}

export interface InitializingBacklogService {
  readonly state: 'initializing';
  readonly initializationPromise: Promise<InitializedBacklogService>;
}

export type BacklogServiceState =
  | UninitializedBacklogService
  | InitializingBacklogService
  | InitializedBacklogService;

// Type guards for service state
export function isInitialized(service: BacklogServiceState): service is InitializedBacklogService {
  return service.state === 'initialized';
}

export function isInitializing(
  service: BacklogServiceState
): service is InitializingBacklogService {
  return service.state === 'initializing';
}

export function isUninitialized(
  service: BacklogServiceState
): service is UninitializedBacklogService {
  return service.state === 'uninitialized';
}
