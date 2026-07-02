/**
 * SpecFuse User Plugin Rules.
 * Each rule must conform to the SyncRule interface.
 */
export default [
  // Example: add a custom sync rule here.
  // {
  //   id:      "custom→constitution:custom",
  //   pass:    "A",
  //   source:  ".specfuse/plan/custom.md",
  //   sources: [".specfuse/plan/custom.md"],
  //   target:  ".specfuse/constitution.md",
  //   section: "custom",
  //   async extract(ctx) {
  //     const c = await ctx.read(".specfuse/plan/custom.md");
  //     return c ? ctx.extractH2Section(c, "My Section") : null;
  //   },
  //   transform(d, ctx) { return "Updated " + ctx.today() + "\n\n" + d; },
  // },
];
