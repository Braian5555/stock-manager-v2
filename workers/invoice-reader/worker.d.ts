// Tipos mínimos para las pruebas.
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
declare const worker: {
  fetch(request: Request, env: Record<string, string | undefined>): Promise<Response>;
  _test: {
    handle(request: Request, env: Record<string, string | undefined>, fetchImpl?: Fetch): Promise<Response>;
    verifyIdToken(token: string, fetchImpl?: Fetch, now?: number): Promise<string>;
    isMember(wsId: string, token: string, uid: string, fetchImpl?: Fetch): Promise<boolean>;
    MODEL: string;
  };
};
export default worker;
