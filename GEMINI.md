# TIPS Portal Monorepo

This repository contains multiple projects for Treasury Inflation-Protected Securities (TIPS) analysis and planning.

## Directory Structure
- `shared/`: Core domain logic and documentation used across all projects.
  - `knowledge/`: Fundamental TIPS and Bond concepts (1.0, 2.1).
  - `src/`: Core financial math (e.g., `bond-math.js`).
- `TipsLadderBuilder/`: The browser-based tool for designing and rebalancing TIPS ladders.
- `TipsSA/`: (New) TIPS Seasonal Adjustments project.

## Development Workflow
- **Shared Logic**: Always prioritize logic in `shared/src/` if it is applicable to more than one project.
- **Serving the UI**: To run the `TipsLadderBuilder` or any other web-based tool, run `npx serve .` from this **root directory**. This ensures that relative imports from `shared/` resolve correctly in the browser.
- **Testing**: Run `npm test` from the root to execute tests across all workspaces.

## Project Vision
To provide a suite of transparent, first-principles tools for managing inflation-protected wealth, ensuring all calculations are traceable and educational.
