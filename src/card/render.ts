/**
 * Tiny Lark interactive card builders. The bridge currently uses `reply` mode
 * by default, so cards are exercised only when config.replyStyle = "card".
 * Kept intentionally minimal so the JSON shape is easy to reason about; extend
 * here when adding streaming progress / tool-call rendering.
 */

export interface CardStateInput {
  title: string;
  body: string;
  footer?: string;
  /** When true, render with a subtle "in progress" header tag. */
  inProgress?: boolean;
}

export function buildCard(input: CardStateInput): unknown {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: input.inProgress ? "blue" : "green",
      title: { tag: "plain_text", content: input.title },
    },
    elements: [
      {
        tag: "markdown",
        content: input.body || (input.inProgress ? "_thinking…_" : "_(empty)_"),
      },
      ...(input.footer
        ? [
            { tag: "hr" },
            {
              tag: "note",
              elements: [{ tag: "plain_text", content: input.footer }],
            },
          ]
        : []),
    ],
  };
}
