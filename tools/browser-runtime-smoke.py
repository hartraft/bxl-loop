#!/usr/bin/env python3
"""Launch the real Brussels Loop page and fail on browser startup/runtime errors."""
import asyncio
import sys
from urllib.parse import urlsplit
from playwright.async_api import async_playwright


async def main(url: str) -> None:
    origin = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=[
            "--enable-unsafe-webgpu",
            "--enable-features=Vulkan",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
        ])
        # A smaller surface and serial shader compilation keep SwiftShader within
        # the memory limits of GitHub-hosted headless runners.
        page = await browser.new_page(viewport={"width": 640, "height": 400}, device_scale_factor=1)
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(f"uncaught page error: {error}"))
        page.on(
            "console",
            lambda message: errors.append(f"console.{message.type}: {message.text}")
            if message.type == "error" else None,
        )

        # Keep app assets same-origin. Fulfil external font/analytics requests with an
        # empty response rather than aborting them (Chromium reports aborts as console
        # errors, which are unrelated to whether the application booted).
        async def isolate_network(route):
            request_url = urlsplit(route.request.url)
            if request_url.netloc == urlsplit(origin).netloc and request_url.scheme == urlsplit(origin).scheme:
                await route.continue_()
            else:
                await route.fulfill(status=204, body="")

        await page.route("**/*", isolate_network)
        try:
            separator = "&" if "?" in url else "?"
            smoke_url = f"{url}{separator}ci-smoke=1"
            response = await page.goto(smoke_url, wait_until="domcontentloaded", timeout=60_000)
            if response is None or not response.ok:
                raise AssertionError(
                    f"Page request failed: {response.status if response else 'no response'}"
                )
            if await page.title() != "Brussels Loop":
                raise AssertionError(f"Unexpected page title: {await page.title()}")
            if not await page.evaluate("() => !!navigator.gpu"):
                raise AssertionError("Chromium does not expose WebGPU; runtime smoke test cannot run")

            # __bxl is installed after scene construction; the loading overlay only hides
            # after the first actual render has completed and the GPU queue has drained.
            await page.wait_for_function(
                """() => !!window.__bxl &&
                    document.querySelector('#loading-overlay')?.classList.contains('hidden')""",
                timeout=360_000,
            )
            await page.wait_for_timeout(1500)

            if await page.locator("#canvas-container canvas").count() < 1:
                raise AssertionError("Application initialized but did not attach a renderer canvas")
            if errors:
                raise AssertionError("Browser reported runtime errors:\n" + "\n".join(errors))

            print(
                "Browser startup smoke test passed: WebGPU initialized, app handle installed, "
                "first frame rendered, loading overlay dismissed, and no browser errors."
            )
        finally:
            await browser.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python tools/browser-runtime-smoke.py <staged-site-url>")
    asyncio.run(main(sys.argv[1]))
