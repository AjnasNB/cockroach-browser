const CANONICAL_HOST = "cockroachbrowser.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const indexPath = url.pathname === "/index.html" || url.pathname.endsWith("/index.html");
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== CANONICAL_HOST || indexPath) {
      url.protocol = "https:";
      url.hostname = CANONICAL_HOST;
      url.port = "";
      if (indexPath) {
        url.pathname = url.pathname.slice(0, -"index.html".length) || "/";
      }
      const finalSegment = url.pathname.split("/").at(-1) ?? "";
      if (url.pathname !== "/" && !url.pathname.endsWith("/") && !finalSegment.includes(".")) {
        url.pathname = `${url.pathname}/`;
      }
      return Response.redirect(url.toString(), 308);
    }
    return env.ASSETS.fetch(request);
  }
};
