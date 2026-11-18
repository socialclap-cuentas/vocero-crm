import { NextResponse, type NextRequest } from "next/server";
import { parseDemoFlag, rutaBloqueadaEnDemo } from "@/server/demo/flag";

/**
 * Modo demo: las rutas técnicas responden 404 (como un módulo apagado).
 * Sin `DEMO_MODE` no hace nada.
 */
export function middleware(req: NextRequest) {
  if (
    parseDemoFlag(process.env.DEMO_MODE) &&
    rutaBloqueadaEnDemo(req.nextUrl.pathname)
  ) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/onboarding/:path*", "/settings/:path*", "/api/settings/:path*", "/api/onboarding/:path*"],
};
