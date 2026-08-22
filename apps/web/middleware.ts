import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

/**
 * Toutes les pages sont protégées sauf /login et les routes d'auth.
 * Le middleware vérifie la présence du cookie de session (rapide) ;
 * la validation réelle de session est faite côté serveur dans le layout
 * protégé (requireSession).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/bootstrap-account") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const cookie = getSessionCookie(request);
  if (!cookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
