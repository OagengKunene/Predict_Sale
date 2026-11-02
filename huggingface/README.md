---
title: Predict Sale
emoji: "📈"
colorFrom: blue
colorTo: indigo
sdk: static
app_file: index.html
fullWidth: true
pinned: false
short_description: Sales forecasts, model evaluation and inventory planning
tags:
  - sales-forecasting
  - demand-forecasting
  - inventory-planning
  - time-series
---

# Predict_Sale — SalesCast AI

A sales and demand forecasting workspace with CSV import, chronological model evaluation, interactive forecast charts, and inventory planning.

The default data is a clearly labelled synthetic example with six products. Upload a continuous daily sales CSV with `date`, `product`, and `units`; `unit_price` is optional. Each product requires at least 140 daily observations and the same final date.

The models train in a browser worker. Uploaded sales remain in that browser session and are not sent to a forecasting server. Forecast ranges and order quantities are planning estimates.

The app includes a complete project download, an executed training notebook, and a project report.

Source and setup instructions: [OagengKunene/Predict_Sale on GitHub](https://github.com/OagengKunene/Predict_Sale).

This Space receives the application's static files from GitHub Actions using a repository-scoped Trusted Publisher. No account password or long-lived access token is stored in the workflow.
