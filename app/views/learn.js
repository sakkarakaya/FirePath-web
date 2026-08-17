import { disclaimer } from "../data/copy.js";
import {
  ALL_CATEGORY,
  buildArticleCards,
  buildCategoryFilters,
  buildLearningStats,
  buildLearningStatusLine,
  describeLevel,
  filterArticlesByCategory,
  findRelatedArticles,
  formatMinutes,
  recommendNextArticle
} from "../domain/learning.js";
import { findArticle, getState, setArticleRead } from "../store/store.js";
import {
  Button,
  Card,
  EmptyState,
  ProgressBar,
  SectionHeader,
  SegmentedControl,
  StatusChip
} from "../ui/components.js";
import { h } from "../ui/dom.js";
import { toast } from "../ui/feedback.js";
import { href } from "../router.js";

/**
 * Learn.
 *
 * The library is ordered by the reader's own onboarding answers rather than a
 * fixed sequence, so the "read next" card reflects the topics and level they
 * picked.
 */

let activeCategory = ALL_CATEGORY;

function requestRerender() {
  window.dispatchEvent(new CustomEvent("firepath:rerender"));
}

export function LearnView() {
  const { articles, profile } = getState();
  const stats = buildLearningStats(articles);
  const filters = buildCategoryFilters(articles);
  const recommendation = recommendNextArticle({ articles, profile });

  // A category can disappear if content changes; fall back rather than showing
  // an empty list under a filter that no longer matches anything.
  if (!filters.some((filter) => filter.key === activeCategory)) {
    activeCategory = ALL_CATEGORY;
  }

  const visible = filterArticlesByCategory(articles, activeCategory);
  const cards = buildArticleCards(visible);

  return h("div", { class: "view" }, [
    h("header", { class: "page-header" }, [
      h("div", { class: "page-header__copy" }, [
        h("p", { class: "eyebrow", text: "Learn" }),
        h("h1", { class: "page-header__title", text: "Financial education, not advice" }),
        h("p", { class: "page-header__description", text: buildLearningStatusLine(stats) })
      ])
    ]),

    h("div", { class: "grid grid--sidebar" }, [
      h("div", { class: "stack" }, [
        SegmentedControl({
          options: filters.map((filter) => filter.key),
          value: activeCategory,
          getLabel: (key) => filters.find((filter) => filter.key === key)?.label ?? key,
          label: "Filter lessons by category",
          onChange: (key) => {
            activeCategory = key;
            requestRerender();
          }
        }),
        cards.length === 0
          ? Card({}, [
              EmptyState({
                icon: "◇",
                title: "No lessons in this category",
                description: "Pick another category to keep reading."
              })
            ])
          : h(
              "div",
              { class: "article-grid" },
              cards.map((card) => ArticleCard({ card }))
            )
      ]),
      h("div", { class: "stack" }, [
        Card({}, [
          SectionHeader({ eyebrow: "Your progress", title: `${stats.readCount} of ${stats.total} read` }),
          ProgressBar({ value: stats.progress, label: "Library complete" }),
          h("p", {
            class: "muted",
            text:
              stats.remainingCount === 0
                ? "Every lesson is read. Revisit any of them any time."
                : `${stats.remainingCount} lessons left, about ${formatMinutes(stats.remainingMinutes)}.`
          })
        ]),
        recommendation ? NextLessonCard({ recommendation }) : null
      ])
    ])
  ]);
}

function NextLessonCard({ recommendation }) {
  const { article, reason } = recommendation;

  return Card({ tone: "primary" }, [
    SectionHeader({ eyebrow: "Read next", title: article.title, description: reason }),
    h("div", { class: "row" }, [
      StatusChip(describeLevel(article.level)),
      StatusChip({ label: formatMinutes(article.readingTime), level: "neutral" })
    ]),
    Button({ to: `/learn/${article.id}`, variant: "secondary" }, "Open lesson")
  ]);
}

function ArticleCard({ card }) {
  const { article } = card;

  return h(
    "a",
    {
      class: `article-card ${article.isRead ? "is-read" : ""}`.trim(),
      href: href(`/learn/${article.id}`)
    },
    [
      h("div", { class: "row" }, [
        StatusChip(card.level),
        article.isRead ? StatusChip({ label: "Read", level: "good", size: "sm" }) : null
      ]),
      h("h3", { class: "article-card__title", text: article.title }),
      h("p", { class: "article-card__preview", text: card.preview }),
      h("span", { class: "article-card__meta", text: card.meta })
    ]
  );
}

/** Single lesson, with key takeaways and where to go next. */
export function ArticleView({ params }) {
  const { articles } = getState();
  const article = findArticle(Number(params.id));

  if (!article) {
    return h("div", { class: "view" }, [
      Card({}, [
        EmptyState({
          icon: "◇",
          title: "Lesson not found",
          description: "This lesson is not part of the installed library.",
          action: Button({ to: "/learn", variant: "primary" }, "Back to Learn")
        })
      ])
    ]);
  }

  const related = findRelatedArticles(article, articles);

  return h("div", { class: "view" }, [
    h("div", { class: "row" }, [Button({ to: "/learn", variant: "ghost", size: "sm" }, "← All lessons")]),

    h("header", { class: "page-header" }, [
      h("div", { class: "page-header__copy" }, [
        h("p", { class: "eyebrow", text: article.category }),
        h("h1", { class: "page-header__title", text: article.title }),
        h("div", { class: "row" }, [
          StatusChip(describeLevel(article.level)),
          StatusChip({ label: formatMinutes(article.readingTime), level: "neutral" }),
          article.isRead ? StatusChip({ label: "Read", level: "good" }) : null
        ])
      ]),
      h("div", { class: "page-header__actions" }, [
        Button(
          {
            variant: article.isRead ? "ghost" : "primary",
            onclick: () => {
              setArticleRead(article.id, !article.isRead);
              toast(article.isRead ? "Marked as unread." : "Lesson marked as read.", {
                level: article.isRead ? "info" : "success"
              });
            }
          },
          article.isRead ? "Mark as unread" : "Mark as read"
        )
      ])
    ]),

    Card({}, [h("div", { class: "prose" }, [h("p", { text: article.content })])]),

    Card({}, [
      SectionHeader({ eyebrow: "Key takeaways", title: "What to remember" }),
      h(
        "ul",
        { class: "takeaways" },
        article.keyTakeaways.map((takeaway) => h("li", {}, [h("span", { text: takeaway })]))
      )
    ]),

    related.length > 0
      ? Card({}, [
          SectionHeader({
            eyebrow: "Keep going",
            title: "Related lessons",
            description: "Unread lessons from this category first."
          }),
          h(
            "div",
            { class: "article-grid" },
            related.map((candidate) =>
              ArticleCard({
                card: {
                  article: candidate,
                  preview: candidate.content.slice(0, 120),
                  meta: `${candidate.category} · ${formatMinutes(candidate.readingTime)}`,
                  level: describeLevel(candidate.level)
                }
              })
            )
          )
        ])
      : null,

    h("p", { class: "disclaimer", text: disclaimer })
  ]);
}
