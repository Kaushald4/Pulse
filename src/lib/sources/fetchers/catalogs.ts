/**
 * Catalogs that publish structured metadata: arXiv, Hugging Face, dev.to,
 * Product Hunt, and GitHub trending.
 */
import type { PulseItem, SourceOptions } from "../../types";
import { invoke, runHelmsman } from "../helmsman";
import { baseItem, joinNames, text, toIso } from "../normalize";
import { count, one } from "../options";

export async function fetchArxiv(options: SourceOptions): Promise<PulseItem[]> {
  const category = one(options.category, "cs.AI");
  const limit = count(options.limit, 15);
  const papers = await runHelmsman("arxiv", ["papers", "--category", category, "--limit", String(limit)]);

  return papers
    .map((paper) => {
      const title = text(paper.title);
      const url = text(paper.url);
      if (!title || !url) return null;
      const authors = joinNames(paper.authors);
      return baseItem({
        id: `arxiv-${text(paper.id) || url}`,
        source: "arxiv",
        sourceType: "arxiv_paper",
        title,
        url,
        body: text(paper.summary) || null,
        author: authors || "arXiv",
        authorUrl: "https://arxiv.org",
        publishedAt: toIso(paper.publishedAt),
        tags: text(paper.category) ? [text(paper.category)] : [],
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

export async function fetchHuggingFace(options: SourceOptions): Promise<PulseItem[]> {
  const limit = count(options.limit, 15);
  const papers = await runHelmsman("huggingface", ["papers", "--limit", String(limit)]);

  return papers
    .map((paper) => {
      const title = text(paper.title);
      const url = text(paper.url);
      if (!title || !url) return null;
      return baseItem({
        id: `hf-${text(paper.id) || url}`,
        source: "huggingface",
        sourceType: "huggingface_paper",
        title,
        url,
        body: text(paper.summary) || null,
        author: joinNames(paper.authors) || "Hugging Face",
        authorUrl: "https://huggingface.co/papers",
        score: Number(paper.upvotes) || 0,
        commentsCount: Number(paper.commentCount) || 0,
        publishedAt: toIso(paper.publishedAt),
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

export async function fetchDevTo(options: SourceOptions): Promise<PulseItem[]> {
  const tag = one(options.tag, "ai");
  const limit = count(options.limit, 15);
  const articles = await runHelmsman("devto", [
    "articles",
    "--tag",
    tag,
    "--top",
    "7",
    "--limit",
    String(limit),
  ]);

  return articles
    .map((article) => {
      const title = text(article.title);
      const url = text(article.url);
      if (!title || !url) return null;
      return baseItem({
        id: `devto-${text(article.id) || url}`,
        source: "devto",
        sourceType: "devto_article",
        title,
        url,
        body: text(article.description) || null,
        author: text(article.author) || null,
        authorUrl: text(article.authorUrl) || null,
        score: Number(article.reactionsCount) || 0,
        commentsCount: Number(article.commentsCount) || 0,
        publishedAt: toIso(article.publishedAt),
        tags: Array.isArray(article.tags) ? article.tags.map(text).filter(Boolean) : [],
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

export async function fetchProductHunt(options: SourceOptions): Promise<PulseItem[]> {
  const limit = count(options.limit, 15);
  const posts = await runHelmsman("producthunt", ["feed", "--limit", String(limit)]);

  return posts
    .map((post) => {
      const title = text(post.name);
      const url = text(post.url) || text(post.website);
      if (!title || !url) return null;
      return baseItem({
        id: `ph-${text(post.id) || url}`,
        source: "producthunt",
        sourceType: "producthunt_post",
        title,
        url,
        body: text(post.tagline) || null,
        score: Number(post.votesCount) || 0,
        commentsCount: Number(post.commentsCount) || 0,
        publishedAt: toIso(post.createdAt),
      });
    })
    .filter((item): item is PulseItem => item !== null);
}

export async function fetchGithub(options: SourceOptions): Promise<PulseItem[]> {
  const days = count(options.days, 7, 1, 90);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const language = (options.language ?? "").trim() || null;
  const limit = count(options.limit, 25);

  const repos = await invoke<
    Array<{
      id: string;
      name: string;
      url: string;
      description: string | null;
      author: string;
      stars: number;
      language: string | null;
      createdAt: string;
    }>
  >("github_trending", { since, language, limit });

  return repos.map((repo) =>
    baseItem({
      id: `github-${repo.id}`,
      source: "github",
      sourceType: "github_repo",
      title: repo.name,
      url: repo.url,
      body: repo.description,
      author: repo.author,
      authorUrl: `https://github.com/${repo.author}`,
      score: repo.stars,
      publishedAt: toIso(repo.createdAt),
      tags: repo.language ? [repo.language] : [],
    })
  );
}
