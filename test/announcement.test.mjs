import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCardRenderer, readProject, validateSlug } from "../scripts/render-announcement.mjs";
import { postCardToX } from "../scripts/x-card.mjs";
import { buildMessage, buildPost, runAnnouncements, waitForProjectPage } from "../scripts/notify-telegram.mjs";

// Stands in for the lit-hub page check, so publishing tests stay offline.
const pageLive = async () => true;

let renderer, temp, example;
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "lit-hub-card-test-"));
  renderer = await createCardRenderer();
  example = await renderer.render(await readProject("telegram-wallet"), path.join(temp, "telegram.png"));
});
after(async () => {
  await renderer?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
});

test("JSON project name and original PNG produce a 1600x900 two-line card", () => {
  assert.equal(example.png.readUInt32BE(16), 1600);
  assert.equal(example.png.readUInt32BE(20), 900);
  assert.equal(example.layout.name, "Telegram Wallet");
  assert.equal(example.layout.fontSize, "144px");
  assert.ok(example.layout.title.height > 250);
  assert.ok(example.layout.title.y + example.layout.title.height < example.layout.tagline.y);
  assert.equal(example.fallbackLogo, false);
});

test("same inputs render identical PNGs", async () => {
  const again = await renderer.render(await readProject("telegram-wallet"), path.join(temp, "again.png"));
  assert.deepEqual(again.png, example.png);
});

for (const slug of ["insilico-terminal", "infinex", "defillama", "oka-finance", "lighter-mcp-by-senya"]) {
  test(`catalog logo format and name fit: ${slug}`, async () => {
    const p = await readProject(slug);
    const { layout, fallbackLogo } = await renderer.render(p, path.join(temp, `${slug}.png`));
    assert.equal(layout.name, p.name);
    assert.equal(fallbackLogo, !p.logo);
    assert.ok(layout.title.x + layout.title.width < layout.logo.x);
    assert.ok(layout.tagline.y + layout.tagline.height < 785);
  });
}

test("long project names shrink without clipping; markup stays literal", async () => {
  const name = 'A Very Long Project <img src=x> & Research Infrastructure';
  const result = await renderer.render({ name, logo: "" }, path.join(temp, "long.png"));
  assert.equal(result.layout.name, name);
  assert.ok(parseFloat(result.layout.fontSize) < 144);
  assert.ok(result.layout.tagline.y + result.layout.tagline.height < 785);
  assert.equal(result.fallbackLogo, true);
});

test("rejects invalid slug, empty name and missing or nonlocal configured logos", async () => {
  assert.throws(() => validateSlug("../../etc/passwd"), /Invalid project slug/);
  await assert.rejects(renderer.render({ name: " " }, path.join(temp, "bad.png")), /Project name/);
  await assert.rejects(renderer.render({ name: "Test", logo: "https://example.com/logo.png" }, path.join(temp, "bad.png")), /local/);
  await assert.rejects(renderer.render({ name: "Test", logo: "/logos/does-not-exist.png" }, path.join(temp, "bad.png")), /ENOENT/);
});

const credentials = { key: "test-key", secret: "test-secret", token: "test-token", tokenSecret: "test-token-secret" };
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});

test("X uploads the actual PNG then attaches its returned ID to the unchanged text", async () => {
  const calls = [];
  const result = await postCardToX({ text: "Existing announcement text", png: example.png, credentials,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return response({ data: { id: calls.length === 1 ? "1234567891234567890" : "999" } });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.x.com/2/media/upload");
  assert.equal(calls[0].body.media_category, "tweet_image");
  assert.deepEqual(Buffer.from(calls[0].body.media, "base64"), example.png);
  assert.match(calls[0].options.headers.authorization, /^OAuth .*oauth_signature=/);
  assert.equal(calls[1].url, "https://api.x.com/2/tweets");
  assert.deepEqual(calls[1].body, { text: "Existing announcement text", media: { media_ids: ["1234567891234567890"] } });
  assert.deepEqual(result, { postId: "999", mediaId: "1234567891234567890" });
});

for (const [label, data, status] of [
  ["permission denied", { detail: "Forbidden" }, 403],
  ["missing media ID", { data: {} }, 200],
  ["pending image", { data: { id: "123", processing_info: { state: "pending" } } }, 200],
  ["partial API error", { data: { id: "123" }, errors: [{ detail: "Rejected" }] }, 200],
]) {
  test(`no text-only post when upload returns ${label}`, async () => {
    let calls = 0;
    await assert.rejects(postCardToX({ text: "Test", png: example.png, credentials,
      fetchImpl: async () => { calls++; return response(data, status); },
    }));
    assert.equal(calls, 1);
  });
}

test("no automatic retry after ambiguous post timeout", async () => {
  let calls = 0;
  await assert.rejects(postCardToX({ text: "Test", png: example.png, credentials,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return response({ data: { id: "123" } });
      throw new Error("Request timed out");
    },
  }), /timed out/);
  assert.equal(calls, 2);
});

test("missing credentials or invalid PNG cannot make a request", async () => {
  const fetchImpl = async () => assert.fail("must not send a request");
  await assert.rejects(postCardToX({ text: "Test", png: example.png, credentials: {}, fetchImpl }), /Missing X credential/);
  await assert.rejects(postCardToX({ text: "Test", png: Buffer.from("bad"), credentials, fetchImpl }), /PNG/);
});

test("full notifier dry run renders JSON-based cards and text without contacting either channel", async () => {
  const outputDir = path.join(temp, "dry-run");
  const code = await runAnnouncements({
    slugs: ["telegram-wallet"], dryRun: true, xEnabled: true, telegramEnabled: true,
    credentials, outputDir, fetchImpl: async () => assert.fail("dry run must not contact X or Telegram"),
  });
  assert.equal(code, 0);
  const png = await readFile(path.join(outputDir, "telegram-wallet.png"));
  assert.deepEqual(png, example.png);
  const project = await readProject("telegram-wallet");
  assert.equal(await readFile(path.join(outputDir, "telegram-wallet.txt"), "utf8"), buildPost("telegram-wallet", project) + "\n");
  assert.equal(await readFile(path.join(outputDir, "telegram-wallet.telegram.txt"), "utf8"),
    buildMessage("telegram-wallet", project) + "\n");
});

// Serializes each request the way fetch would, so multipart bodies are checked as sent.
function recordingFetch(calls, telegramReply = () => ({ ok: true, result: {} })) {
  return async (url, options) => {
    const request = new Request(url, options);
    const method = new URL(url).pathname.split("/").pop();
    if (url.startsWith("https://api.telegram.org/")) {
      const multipart = request.headers.get("content-type").startsWith("multipart/form-data");
      calls.push({ channel: "telegram", method, query: new URL(url).searchParams,
        form: multipart ? await request.formData() : null, json: multipart ? null : await request.json() });
      const [data, status] = [].concat(telegramReply(method));
      return response(data, status ?? 200);
    }
    calls.push({ channel: "x", body: await request.json() });
    return response({ data: { id: String(calls.length) } });
  };
}

test("Telegram uploads the same card as X, with the existing HTML caption", async () => {
  const calls = [];
  const outputDir = path.join(temp, "both-channels");
  const code = await runAnnouncements({
    slugs: ["telegram-wallet"], dryRun: false, xEnabled: true, telegramEnabled: true,
    credentials, outputDir, waitForPage: pageLive, fetchImpl: recordingFetch(calls),
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => c.method ?? c.channel), ["sendPhoto", "x", "x"]);
  const card = await readFile(path.join(outputDir, "telegram-wallet.png"));
  assert.deepEqual([...calls[0].form.keys()], ["photo"]);
  const photo = calls[0].form.get("photo");
  assert.equal(photo.type, "image/png");
  assert.equal(photo.name, "telegram-wallet.png");
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), card);
  assert.deepEqual(Buffer.from(calls[1].body.media, "base64"), card);
  // Exact caption, \n line breaks intact.
  assert.equal(calls[0].query.get("caption"), buildMessage("telegram-wallet", await readProject("telegram-wallet")));
  assert.equal(calls[0].query.get("parse_mode"), "HTML");
});

test("a rejected Telegram photo still sends the text announcement", async () => {
  const calls = [];
  const code = await runAnnouncements({
    slugs: ["vooi"], dryRun: false, xEnabled: false, telegramEnabled: true,
    credentials, outputDir: path.join(temp, "photo-rejected"), waitForPage: pageLive,
    fetchImpl: recordingFetch(calls, (method) =>
      method === "sendPhoto" ? [{ ok: false, description: "Bad Request: wrong file" }, 400] : { ok: true, result: {} }),
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => c.method), ["sendPhoto", "sendMessage"]);
  assert.equal(calls[1].json.text, buildMessage("vooi", await readProject("vooi")));
});

test("when the card can't be rendered, Telegram sends text and X sends nothing", async () => {
  const calls = [];
  const code = await runAnnouncements({
    slugs: ["telegram-wallet"], dryRun: false, xEnabled: true, telegramEnabled: true,
    credentials, outputDir: path.join(temp, "no-card"), waitForPage: pageLive,
    rendererFactory: async () => ({
      render: async () => { throw new Error("Corrupt logo"); },
      close: async () => {},
    }),
    fetchImpl: recordingFetch(calls),
  });
  assert.equal(code, 1);
  assert.deepEqual(calls.map((c) => c.method ?? c.channel), ["sendMessage"]);
});

test("full notifier renders each project and attaches its own media ID, using one browser", async () => {
  const calls = [];
  let created = 0, closed = 0;
  const outputDir = path.join(temp, "notifier");
  const code = await runAnnouncements({
    slugs: ["telegram-wallet", "vooi", "telegram-wallet"], dryRun: false,
    xEnabled: true, telegramEnabled: false, credentials, outputDir, waitForPage: pageLive,
    rendererFactory: async () => {
      created++;
      const instance = await createCardRenderer();
      return { render: instance.render, close: async () => { closed++; await instance.close(); } };
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response({ data: { id: String(calls.length) } });
    },
  });
  assert.equal(code, 0);
  assert.equal(created, 1);
  assert.equal(closed, 1);
  assert.equal(calls.length, 4);
  for (const [index, slug] of ["telegram-wallet", "vooi"].entries()) {
    const upload = calls[index * 2];
    assert.deepEqual(Buffer.from(upload.body.media, "base64"), await readFile(path.join(outputDir, `${slug}.png`)));
    assert.deepEqual(calls[index * 2 + 1].body, {
      text: buildPost(slug, await readProject(slug)), media: { media_ids: [String(index * 2 + 1)] },
    });
  }
  assert.notEqual(calls[0].body.media, calls[2].body.media);
});

test("full notifier fails without posting when rendering fails and still closes the browser", async () => {
  let closed = false;
  const code = await runAnnouncements({
    slugs: ["telegram-wallet"], dryRun: false, xEnabled: true, telegramEnabled: false,
    credentials, outputDir: path.join(temp, "failure"), waitForPage: pageLive,
    rendererFactory: async () => ({
      render: async () => { throw new Error("Corrupt logo"); },
      close: async () => { closed = true; },
    }),
    fetchImpl: async () => assert.fail("must not post without a card"),
  });
  assert.equal(code, 1);
  assert.equal(closed, true);
});

test("unconfigured channels and empty batches do not launch a browser or publish", async () => {
  const options = {
    dryRun: false, xEnabled: false, telegramEnabled: false,
    rendererFactory: async () => assert.fail("no browser needed"),
    fetchImpl: async () => assert.fail("no network needed"),
  };
  assert.equal(await runAnnouncements({ ...options, slugs: ["telegram-wallet"] }), 0);
  assert.equal(await runAnnouncements({ ...options, slugs: [] }), 0);
});

test("nothing is posted for a project whose lit-hub page never loads", async () => {
  const calls = [];
  const code = await runAnnouncements({
    slugs: ["vooi"], dryRun: false, xEnabled: true, telegramEnabled: true,
    credentials, outputDir: path.join(temp, "page-missing"),
    waitForPage: async () => false, fetchImpl: recordingFetch(calls),
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
});

test("the page check retries until the page answers 200, and gives up after its attempts", async () => {
  const urls = [];
  const statuses = [404, 404, 200];
  const sleeps = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response("", { status: statuses.shift() ?? 404 });
  };
  const sleep = async (ms) => { sleeps.push(ms); };
  assert.equal(await waitForProjectPage("vooi", { attempts: 5, intervalMs: 7, fetchImpl, sleep }), true);
  assert.deepEqual(urls, Array(3).fill("https://lit-hub.org/ecosystem/vooi"));
  assert.deepEqual(sleeps, [7, 7]);

  const failing = async () => { throw new Error("connection refused"); };
  sleeps.length = 0;
  assert.equal(await waitForProjectPage("vooi", { attempts: 3, intervalMs: 7, fetchImpl: failing, sleep }), false);
  assert.deepEqual(sleeps, [7, 7]);
});
