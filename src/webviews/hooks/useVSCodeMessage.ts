import { useEffect, useCallback, useRef } from 'react';

export interface VSCodeAPI {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

let vscodeApi: VSCodeAPI | undefined;

export function getVSCodeAPI(): VSCodeAPI {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

export function useVSCodeMessage<T = any>(
  handler: (message: T) => void
): (command: string, payload?: any) => void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: MessageEvent<T>) => {
      handlerRef.current(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  const postMessage = useCallback((command: string, payload?: any) => {
    getVSCodeAPI().postMessage({ command, ...payload });
  }, []);

  return postMessage;
}
