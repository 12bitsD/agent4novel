import { writeFile } from "node:fs/promises";

// 2026-11-18 用户反馈“还是不要看板娘了”：取消人物插画，仅保留品牌字标、书页 Logo 与版式。
const palette = {
  paper: "#f7f4ee",
  ink: "#292724",
  inkSoft: "#5d5750",
  red: "#8a2d2d",
  shadow: "#d8d0c4",
};

function document(title, description, body, width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${description}</desc>
${body}
</svg>
`;
}

function hero(english) {
  const eyebrow = english ? "LOCAL-FIRST WRITING STUDIO" : "本机创作 · 中文写作工作台";
  const title = english ? "Your story. Your call." : "把灵感写成故事，把决定权留给作者。";
  const subtitle = english
    ? "AI-assisted Chinese writing · Local app · Browser based"
    : "AI 辅助中文网文创作 · 本机运行 · 浏览器使用";
  return document(
    "agent4novel",
    english ? subtitle : `${title}；${subtitle}`,
    `
    <rect width="1200" height="400" fill="${palette.paper}"/>
    <path d="M0 0h1200v400H0z" fill="none" stroke="${palette.shadow}" stroke-width="2"/>
    <g id="brand-copy">
      <path d="M74 62l10 10-10 10-10-10z" fill="${palette.red}"/>
      <text x="98" y="78" fill="${palette.inkSoft}" font-family="'SFMono-Regular', Consolas, 'Liberation Mono', monospace" font-size="16" letter-spacing="2.5">${eyebrow}</text>
      <text x="70" y="183" fill="${palette.ink}" font-family="'Courier New', Courier, monospace" font-size="72" font-weight="700" letter-spacing="-4">agent4novel</text>
      <text x="74" y="245" fill="${palette.ink}" font-family="Georgia, 'Songti SC', 'Noto Serif CJK SC', serif" font-size="${english ? 34 : 27}">${title}</text>
      <text x="74" y="289" fill="${palette.inkSoft}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="18">${subtitle}</text>
      <path d="M74 334h248" stroke="${palette.ink}" stroke-width="2"/>
      <path d="M74 334h72" stroke="${palette.red}" stroke-width="5"/>
    </g>
    <g id="book-mark" transform="translate(925 72)">
      <rect x="0" y="0" width="170" height="170" rx="8" fill="#fffdf8" stroke="${palette.shadow}" stroke-width="2"/>
      <g fill="none" stroke="${palette.ink}" stroke-width="4" stroke-linecap="square" stroke-linejoin="miter">
        <path d="M35 45h32l18 12 18-12h32v80H103L85 137l-18-12H35z"/>
        <path d="M85 57v80M51 66h16M51 82h16M51 98h16M103 66h16M103 82h16M103 98h16"/>
      </g>
      <path d="M142 24l12 12-12 12-12-12z" fill="${palette.red}"/>
      <path d="M28 194h114" stroke="${palette.ink}" stroke-width="2"/>
      <path d="M28 194h38" stroke="${palette.red}" stroke-width="4"/>
    </g>`,
    1200,
    400,
  );
}

await writeFile(new URL("../docs/assets/readme-hero.svg", import.meta.url), hero(false));
await writeFile(new URL("../docs/assets/readme-hero.en.svg", import.meta.url), hero(true));
