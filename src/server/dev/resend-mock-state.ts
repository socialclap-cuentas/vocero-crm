/** 071 — Estado del mock de Resend (solo entorno de pruebas): los correos que "salieron". */
export type MockMail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  auth: string | null;
};

const g = globalThis as unknown as { __resendMock?: { mails: MockMail[]; fail: boolean } };

export function resendMockState() {
  if (!g.__resendMock) g.__resendMock = { mails: [], fail: false };
  return g.__resendMock;
}

export function resetResendMock(): void {
  const s = resendMockState();
  s.mails.length = 0;
  s.fail = false;
}
