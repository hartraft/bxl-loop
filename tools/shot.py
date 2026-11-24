import sys, asyncio
from PIL import Image
from playwright.async_api import async_playwright

url, out = sys.argv[1], sys.argv[2]
wait = int(sys.argv[3]) if len(sys.argv) > 3 else 20
min_coverage = 0.0
require_full = False
for arg in sys.argv[4:]:
    if arg == "full":
        require_full = True
    else:
        min_coverage = float(arg)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--enable-unsafe-webgpu","--enable-features=Vulkan","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width":960,"height":540})
        logs=[]
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"[:300]))
        pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"[:500]))
        await pg.route("**/*", lambda r: r.abort() if not r.request.url.startswith("http://localhost") else r.continue_())
        await pg.goto(url, wait_until="domcontentloaded")
        await pg.wait_for_timeout(wait*1000)
        info = await pg.evaluate("()=>({gpu: !!navigator.gpu, title: document.title, txt: document.body.innerText.slice(0,200), ready: !!window.__snapshotReady, framing: window.__snapshotFraming || null})")
        await pg.screenshot(path=out, timeout=120000)
        print(info); print("\n".join(logs[-30:]))
        await b.close()
    assert info.get("ready"), "snapshot page never signalled window.__snapshotReady"
    check_render(out, info.get("framing"))

def check_render(out, framing):
    img = Image.open(out).convert("RGB")
    w, h = img.size
    assert (w, h) == (960, 540), f"unexpected snapshot size {w}x{h}"
    px = list(img.getdata())
    n = len(px)
    lums = [0.2126*r + 0.7152*g + 0.0722*b for (r, g, b) in px]
    mean = sum(lums) / n
    stdev = (sum((l - mean) ** 2 for l in lums) / n) ** 0.5
    colors = len({(r >> 4, g >> 4, b >> 4) for (r, g, b) in px})
    assert stdev >= 6.0, f"render looks empty or flat: luminance stdev {stdev:.2f}"
    assert colors >= 48, f"render has too few distinct colours ({colors})"
    if min_coverage > 0 or require_full:
        assert framing, "page did not expose window.__snapshotFraming"
        x0, y0, x1, y1 = framing["x0"], framing["y0"], framing["x1"], framing["y1"]
        cx0, cy0, cx1, cy1 = max(-1.0, x0), max(-1.0, y0), min(1.0, x1), min(1.0, y1)
        assert cx1 > cx0 and cy1 > cy0, f"target landmark is outside the frame: box=({x0:.2f},{y0:.2f},{x1:.2f},{y1:.2f})"
        coverage = (cx1 - cx0) * (cy1 - cy0) / 4
        assert coverage >= min_coverage, f"target covers only {coverage:.3f} of the frame (min {min_coverage})"
        if require_full:
            assert x0 >= -1.02 and x1 <= 1.02 and y0 >= -1.02 and y1 <= 1.02, f"target not fully in frame: box=({x0:.2f},{y0:.2f},{x1:.2f},{y1:.2f})"

asyncio.run(main())
