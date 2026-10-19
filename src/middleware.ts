import { NextResponse, type NextRequest } from "next/server";

/**
 * 初步攔截：無工作階段 Cookie 時導向登入頁。
 * 真正的工作階段驗證與權限判斷於伺服器端（頁面、Server Action、API）執行。
 */
const PUBLIC_PATHS = ["/login", "/api/health", "/api/cron", "/manifest.webmanifest", "/icons"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get("szm_session")?.value) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "請先登入" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
