/**
 * Learn view logic. The screen only arranges what this module decides: how far
 * the reader has got, which lesson to suggest next and how each article is
 * summarised in a list.
 *
 * The suggestion is built from what the reader already told onboarding — their
 * experience level and chosen topics — so the page reflects them instead of
 * showing everyone the same fixed order.
 */

/** Onboarding topics are short keywords; article categories are longer titles. */
const TOPIC_CATEGORIES = {
  FIRE: ["FIRE Basics"],
  ETF: ["ETF Basics"],
  Budgeting: ["Budgeting"],
  Taxes: ["Taxes"],
  Risk: ["Portfolio Risk"],
  Dividends: ["ETF Basics"]
};

export const ALL_CATEGORY = "All";

const levelLabels = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced"
};

export function buildLearningStats(articles) {
  const total = articles.length;
  const readCount = articles.filter((article) => article.isRead).length;
  const unread = articles.filter((article) => !article.isRead);

  return {
    total,
    readCount,
    progress: total === 0 ? 0 : readCount / total,
    remainingCount: unread.length,
    remainingMinutes: unread.reduce((sum, article) => sum + Math.max(0, article.readingTime), 0)
  };
}

export function buildLearningStatusLine(stats) {
  if (stats.total === 0) {
    return "No lessons are installed in this browser yet.";
  }

  if (stats.remainingCount === 0) {
    return "You have read every lesson in the library.";
  }

  if (stats.readCount === 0) {
    return `${stats.total} short lessons, about ${formatMinutes(stats.remainingMinutes)} in total.`;
  }

  return `${stats.readCount} of ${stats.total} read — about ${formatMinutes(stats.remainingMinutes)} left.`;
}

/** Reading time as "45 min" below an hour, "1h 15m" above it. */
export function formatMinutes(minutes) {
  const safe = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));

  if (safe < 60) {
    return `${safe} min`;
  }

  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Filters derived from the articles themselves. A hardcoded list drifts as soon
 * as content changes and offers categories that match nothing.
 */
export function buildCategoryFilters(articles) {
  const order = [];
  const counts = new Map();

  for (const article of articles) {
    const existing = counts.get(article.category);

    if (existing) {
      existing.total += 1;
      existing.readCount += article.isRead ? 1 : 0;
      continue;
    }

    order.push(article.category);
    counts.set(article.category, { total: 1, readCount: article.isRead ? 1 : 0 });
  }

  const all = {
    key: ALL_CATEGORY,
    label: `All ${articles.length}`,
    total: articles.length,
    readCount: articles.filter((article) => article.isRead).length
  };

  return [
    all,
    ...order.map((category) => {
      const entry = counts.get(category) ?? { total: 0, readCount: 0 };
      return {
        key: category,
        label: `${category} ${entry.total}`,
        total: entry.total,
        readCount: entry.readCount
      };
    })
  ];
}

export function filterArticlesByCategory(articles, category) {
  if (category === ALL_CATEGORY) {
    return articles;
  }

  return articles.filter((article) => article.category === category);
}

export function buildArticleCards(articles) {
  return articles.map((article) => ({
    article,
    preview: buildPreview(article.content),
    meta: `${article.category} · ${formatMinutes(article.readingTime)}`,
    level: describeLevel(article.level)
  }));
}

/** Levels are ordered, so they read as a ladder rather than as a warning. */
export function describeLevel(level) {
  if (level === "beginner") {
    return { label: levelLabels.beginner, level: "good" };
  }

  if (level === "intermediate") {
    return { label: levelLabels.intermediate, level: "watch" };
  }

  return { label: levelLabels.advanced, level: "neutral" };
}

export function buildPreview(content) {
  const trimmed = content.trim();

  if (trimmed === "") {
    return "";
  }

  // A sentence end followed by a space; anything shorter stays whole.
  const match = trimmed.match(/^.*?[.!?](?=\s)/);
  return match ? match[0] : trimmed;
}

/**
 * The next lesson to read. Topics the reader picked during onboarding outrank a
 * matching experience level, and library order breaks any tie so the choice
 * stays stable between renders.
 */
export function recommendNextArticle({ articles, profile }) {
  const unread = articles.filter((article) => !article.isRead);

  if (unread.length === 0) {
    return null;
  }

  if (!profile) {
    return { article: unread[0], reason: "Start here — the library opens with the basics." };
  }

  const topicCategories = categoriesForTopics(profile.learningTopics);

  let best = unread[0];
  let bestScore = -1;

  for (const article of unread) {
    const score = scoreArticle(article, topicCategories, profile.investingExperience);

    if (score > bestScore) {
      best = article;
      bestScore = score;
    }
  }

  return { article: best, reason: describeReason(best, topicCategories, profile.investingExperience) };
}

function scoreArticle(article, topicCategories, experience) {
  let score = 0;

  if (topicCategories.has(article.category)) {
    score += 4;
  }

  if (article.level === experience) {
    score += 2;
  }

  return score;
}

function describeReason(article, topicCategories, experience) {
  const matchesTopic = topicCategories.has(article.category);
  const matchesLevel = article.level === experience;

  if (matchesTopic && matchesLevel) {
    return `${article.category} is one of your topics, at the ${levelLabels[
      experience
    ].toLowerCase()} level you picked.`;
  }

  if (matchesTopic) {
    return `${article.category} is one of the topics you chose during onboarding.`;
  }

  if (matchesLevel) {
    return `Written for the ${levelLabels[experience].toLowerCase()} level you selected.`;
  }

  return "Next unread lesson in the library.";
}

function categoriesForTopics(topics) {
  const categories = new Set();

  for (const topic of topics ?? []) {
    for (const category of TOPIC_CATEGORIES[topic] ?? []) {
      categories.add(category);
    }
  }

  return categories;
}

/**
 * Where to go after finishing an article: unread lessons from the same category
 * first, then anything else unread, so a reader can stay on one subject.
 */
export function findRelatedArticles(article, articles, limit = 2) {
  const others = articles.filter((candidate) => candidate.id !== article.id && !candidate.isRead);
  const sameCategory = others.filter((candidate) => candidate.category === article.category);
  const rest = others.filter((candidate) => candidate.category !== article.category);

  return [...sameCategory, ...rest].slice(0, Math.max(0, limit));
}
