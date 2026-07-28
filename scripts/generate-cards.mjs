#!/usr/bin/env node
// Generates the profile's stat cards as self-hosted SVGs so no external
// card service can break the README. Runs in GitHub Actions with the
// default GITHUB_TOKEN; output lands in OUT_DIR for the `output` branch.
//
//   node scripts/generate-cards.mjs         # real data (needs GITHUB_TOKEN)
//   node scripts/generate-cards.mjs --mock  # offline render test

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const USER = process.env.PROFILE_USER || "Hadesfenyx";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_DIR || "dist";
const MOCK = process.argv.includes("--mock");

const T = {
  bg: "#1a1b27",
  fg: "#a9b1d6",
  muted: "#565f89",
  title: "#7aa2f7",
  accents: ["#7aa2f7", "#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#f7768e"],
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

async function fetchData() {
  const query = `query($login: String!) {
    user(login: $login) {
      name
      createdAt
      followers { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      contributionsCollection {
        totalCommitContributions
        contributionCalendar { totalContributions }
      }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": USER,
    },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL errors: " + JSON.stringify(json.errors));
  return json.data.user;
}

function mockData() {
  return {
    name: "Hades",
    createdAt: "2023-09-12T16:22:42Z",
    followers: { totalCount: 3 },
    pullRequests: { totalCount: 2 },
    issues: { totalCount: 1 },
    contributionsCollection: {
      totalCommitContributions: 12,
      contributionCalendar: { totalContributions: 15 },
    },
    repositories: {
      totalCount: 2,
      nodes: [
        {
          stargazerCount: 4,
          languages: {
            edges: [
              { size: 6000, node: { name: "Python", color: "#3572A5" } },
              { size: 4000, node: { name: "JavaScript", color: "#f1e05a" } },
            ],
          },
        },
      ],
    },
  };
}

function shape(u) {
  const langTotals = new Map();
  let stars = 0;
  for (const repo of u.repositories.nodes) {
    stars += repo.stargazerCount;
    for (const { size, node } of repo.languages.edges) {
      const cur = langTotals.get(node.name) || { size: 0, color: node.color };
      cur.size += size;
      langTotals.set(node.name, cur);
    }
  }
  const totalSize = [...langTotals.values()].reduce((a, l) => a + l.size, 0);
  const langs = [...langTotals.entries()]
    .map(([name, { size, color }]) => ({ name, color: color || T.accents[0], pct: (size / totalSize) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);
  const years = Math.max(0, Math.floor((Date.now() - Date.parse(u.createdAt)) / 31557600000));
  return {
    name: u.name || USER,
    stars,
    commits: u.contributionsCollection.totalCommitContributions,
    prs: u.pullRequests.totalCount,
    issues: u.issues.totalCount,
    followers: u.followers.totalCount,
    contributions: u.contributionsCollection.contributionCalendar.totalContributions,
    repos: u.repositories.totalCount,
    years,
    langs,
  };
}

// 16x16 octicon-style paths
const ICONS = {
  star: '<path fill="ICON" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>',
  commit: '<circle cx="8" cy="8" r="3" fill="none" stroke="ICON" stroke-width="1.6"/><path stroke="ICON" stroke-width="1.6" d="M0 8h4.6M11.4 8H16"/>',
  pr: '<path fill="ICON" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/>',
  issue: '<circle cx="8" cy="8" r="6.5" fill="none" stroke="ICON" stroke-width="1.6"/><circle cx="8" cy="8" r="1.7" fill="ICON"/>',
  people: '<path fill="ICON" d="M10.561 8.073a6 6 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6 6 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/>',
};

const fadeIn = (delay) =>
  `<animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${delay}s" fill="freeze"/>`;

function card(width, height, title, body) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="12" fill="${T.bg}"/>
  <text x="24" y="36" font-family="'Segoe UI',Ubuntu,Helvetica,Arial,sans-serif" font-size="17" font-weight="700" fill="${T.title}">${esc(title)}</text>
${body}
</svg>\n`;
}

function statsCard(d) {
  const rows = [
    { icon: "star", label: "Total Stars Earned", value: fmt(d.stars) },
    { icon: "commit", label: "Commits (this year)", value: fmt(d.commits) },
    { icon: "pr", label: "Pull Requests", value: fmt(d.prs) },
    { icon: "issue", label: "Issues", value: fmt(d.issues) },
    { icon: "people", label: "Followers", value: fmt(d.followers) },
  ];
  const body = rows
    .map((r, i) => {
      const y = 62 + i * 27;
      const color = T.accents[i % T.accents.length];
      return `  <g opacity="0">${fadeIn(0.15 * i)}
    <g transform="translate(24 ${y - 12})">${ICONS[r.icon].replaceAll("ICON", color)}</g>
    <text x="52" y="${y}" font-family="'Segoe UI',Ubuntu,sans-serif" font-size="14" fill="${T.fg}">${esc(r.label)}</text>
    <text x="440" y="${y}" text-anchor="end" font-family="'Segoe UI',Ubuntu,sans-serif" font-size="14" font-weight="700" fill="${color}">${esc(r.value)}</text>
  </g>`;
    })
    .join("\n");
  return card(467, 210, `${d.name}'s GitHub Stats`, body);
}

function langsCard(d) {
  let body;
  if (d.langs.length === 0) {
    body = `  <g opacity="0">${fadeIn(0.2)}
    <text x="24" y="90" font-family="'Segoe UI',Ubuntu,sans-serif" font-size="14" fill="${T.fg}">Fresh start — code is on the way.</text>
    <text x="24" y="112" font-family="'Segoe UI',Ubuntu,sans-serif" font-size="13" fill="${T.muted}">Languages appear here with the first public push.</text>
  </g>`;
  } else {
    const barX = 24, barW = 292, barY = 56;
    let x = barX;
    const segs = d.langs
      .map((l) => {
        const w = Math.max(4, (l.pct / 100) * barW);
        const seg = `    <rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`;
        x += w;
        return seg;
      })
      .join("\n");
    const legend = d.langs
      .map((l, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const lx = barX + col * 150, ly = barY + 40 + row * 24;
        return `  <g opacity="0">${fadeIn(0.15 * i + 0.3)}
    <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${l.color}"/>
    <text x="${lx + 18}" y="${ly}" font-family="'Segoe UI',Ubuntu,sans-serif" font-size="13" fill="${T.fg}">${esc(l.name)} <tspan fill="${T.muted}">${l.pct.toFixed(1)}%</tspan></text>
  </g>`;
      })
      .join("\n");
    body = `  <g opacity="0">${fadeIn(0.1)}
  <clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#bar)">\n${segs}\n  </g>
  </g>\n${legend}`;
  }
  return card(340, 210, "Most Used Languages", body);
}

function milestonesCard(d) {
  const tiles = [
    { value: `${d.years}+`, label: "Years on GitHub" },
    { value: fmt(d.repos), label: "Public Repos" },
    { value: fmt(d.contributions), label: "Contributions" },
    { value: fmt(d.stars), label: "Stars Earned" },
    { value: fmt(d.followers), label: "Followers" },
  ];
  const w = 860, tileW = (w - 48) / tiles.length;
  const body = tiles
    .map((t, i) => {
      const cx = 24 + tileW * i + tileW / 2;
      const color = T.accents[i % T.accents.length];
      const sep = i > 0 ? `  <rect x="${(24 + tileW * i).toFixed(1)}" y="58" width="1" height="52" fill="${T.muted}" opacity="0.35"/>` : "";
      return `${sep}
  <g opacity="0">${fadeIn(0.15 * i)}
    <text x="${cx.toFixed(1)}" y="92" text-anchor="middle" font-family="'Segoe UI',Ubuntu,sans-serif" font-size="30" font-weight="800" fill="${color}">${esc(t.value)}</text>
    <text x="${cx.toFixed(1)}" y="116" text-anchor="middle" font-family="'Segoe UI',Ubuntu,sans-serif" font-size="13" fill="${T.fg}">${esc(t.label)}</text>
  </g>`;
    })
    .join("\n");
  return card(w, 140, "Milestones", body);
}

const data = shape(MOCK ? mockData() : await fetchData());
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "stats-card.svg"), statsCard(data));
writeFileSync(join(OUT, "top-langs-card.svg"), langsCard(data));
writeFileSync(join(OUT, "milestones-card.svg"), milestonesCard(data));
console.log(`Generated 3 cards in ${OUT}/ for ${data.name} (${MOCK ? "mock" : "live"} data)`);
