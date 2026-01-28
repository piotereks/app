export default {
  async fetch(request) {
    const url = new URL(request.url)
    const target = url.searchParams.get("url")

    if (!target) {
      return new Response("Missing url param", { status: 400 })
    }

    const resp = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    })

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      }
    })
  }
}
