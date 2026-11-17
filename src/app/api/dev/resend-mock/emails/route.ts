import { mockGuard } from "@/lib/dev-guard";
import { resendMockState, resetResendMock } from "@/server/dev/resend-mock-state";

export const dynamic = "force-dynamic";

/**
 * 071 — Resend de mentira para el self-test. Tras `mockGuard()`: 404 en producción.
 * POST = envío (como `POST /emails`), GET = lo enviado, DELETE = reset,
 * PUT {fail:true} = hace que los próximos envíos se rechacen (camino infeliz).
 */
export async function POST(req: Request) {
  const denied = mockGuard();
  if (denied) return denied;
  const s = resendMockState();
  if (s.fail) {
    return Response.json({ message: "The domain is not verified" }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  s.mails.push({
    from: String(b.from ?? ""),
    to: Array.isArray(b.to) ? (b.to as string[]) : [],
    subject: String(b.subject ?? ""),
    text: String(b.text ?? ""),
    auth: req.headers.get("authorization"),
  });
  return Response.json({ id: `mock_${s.mails.length}` });
}

export async function GET() {
  const denied = mockGuard();
  if (denied) return denied;
  return Response.json({ mails: resendMockState().mails });
}

export async function PUT(req: Request) {
  const denied = mockGuard();
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { fail?: boolean };
  resendMockState().fail = Boolean(b.fail);
  return Response.json({ ok: true });
}

export async function DELETE() {
  const denied = mockGuard();
  if (denied) return denied;
  resetResendMock();
  return Response.json({ ok: true });
}
