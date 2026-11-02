# SalesCast-AI — Sales and Demand Forecaster

Prepared for Kunene · 2 November 2026

## 1. Objective and scope

SalesCast-AI converts daily product sales into evaluated forecasts, estimated future sales values, and stock-planning signals. The project includes a working web application, CSV import, a Python machine-learning pipeline, an executed training notebook, tests, and reproducible synthetic data. Models run in a browser worker, so an uploaded sales CSV is not transmitted to a forecasting server.

The target is observed units sold, rather than unconstrained demand. Stockouts, lost sales, returns, channel changes, promotional calendars, and changes in product availability are not modelled. These limits matter because low recorded sales can reflect limited availability rather than low customer demand.

## 2. Demonstration dataset

The demo contains six fictional products: Moringa Capsules, Hibiscus Tea, Spirulina Powder, Baobab Blend, Ginger Tonic, and Herbal Starter Kit. Each has 730 daily observations from 2 November 2024 through 1 November 2026. The total is 4,380 records. Product names describe a fictional botanical-products business; the data does not represent a real co-operative or its production records.

Sales are generated with NumPy random seed 20261102. Each product has a baseline, trend, weekday effects, annual seasonality, noise, and occasional unsignalled promotional shocks. Negative generated quantities are clipped at zero and rounded to whole units. Prices, opening stock, supplier lead times, and safety-cover settings are explicit design assumptions in catalog.json. Their values are not current market prices or measured inventory.

## 3. Import and data quality

CSV files must include date, product, and units; unit_price is optional. The date format is YYYY-MM-DD. Quantities and prices must be finite, non-negative numbers. Each product requires at least 140 daily observations, giving at least 56 initial training days, 56 validation days, and 28 final test days. All products must end on the same date.

The importer supports quoted fields, escaped quotes, UTF-8 BOMs, and comma or semicolon delimiters. Duplicate product/date observations are aggregated by summing units and known revenue. Missing dates cause a clear validation error rather than automatic zero imputation. A zero should be added only when it represents a known day with no sales. Incomplete or invalid imports leave the previous working forecast intact.

The application supports up to 30,000 input rows, 50 products, and 8 MB per file. These are browser-workspace limits, not universal forecasting requirements. Uploaded data remains in memory and is cleared on reload. Local stock settings are stored in that browser. The display-currency selector only changes labels; it performs no currency conversion.

## 4. Forecasting models

### Calendar Ridge regression

A separate supervised regression is fitted for each product. Features include an intercept, elapsed years from the product's first observation, and six weekday indicator variables with Sunday as the reference day. When the earliest training window covers at least 365 days, two annual Fourier harmonics are added using a 365.25-day period. Otherwise, annual terms are disabled for every evaluation and final fit of that product, keeping the feature specification consistent.

The objective is squared prediction error plus an L2 penalty of alpha = 3 on non-intercept coefficients. The intercept is unpenalised. Python uses scikit-learn Ridge with fit_intercept=True and the SVD solver. The browser solves the equivalent regularised normal equations with partial pivoting. Predicted units are clipped at zero.

### Weekly seasonal-naïve baseline

The final seven observed daily values are repeated into the future. At each validation or test origin, the baseline uses only values observed before that origin. It does not use actual sales from inside the target forecast window.

Both models can be selected manually in the interface. Auto-select chooses between them based on validation absolute errors. A more complex model is not assumed to be better simply because it uses machine learning.

## 5. Chronological evaluation and model selection

With N observations, validation forecasts begin at N − 84 and N − 56. Each origin predicts the next 28 days from an expanding historical training set. This yields 56 validation errors for each candidate model. Auto-select chooses the model with the lower summed absolute validation error; ties choose the simpler weekly baseline.

The final 28 days, beginning at N − 28, are an independent test. These targets are excluded from model selection. Both models are trained using only earlier observations, then predict this final window. After evaluation, the selected model is refitted on all available observations for future forecasts. Forecasts can be displayed for 14, 30, 60, or 90 days; the engine computes 180 days to support stock-cover calculations.

The reported test validates a 28-day forecasting window. Longer views extend beyond that evaluated horizon. Manual changes of model can support investigation, but selecting a model after examining test results would weaken the test's independence.

## 6. Metrics and measured demo results

Mean absolute error (MAE) is the mean absolute difference between predicted and actual daily units. Root mean squared error (RMSE) gives more weight to large errors. Weighted absolute percentage error (WAPE) is:

WAPE = sum of absolute errors / sum of actual units.

For portfolio WAPE, absolute errors are computed at product/day level before summing. Opposing product errors therefore cannot cancel. When actual units sum to zero, WAPE is undefined and shown as an em dash; it is not reported as zero accuracy or an infinite percentage.

On the generated demo dataset, auto-selection chooses calendar regression for all six products. The portfolio final-test WAPE is **7.6190535908%**, versus **11.4821231690%** for the weekly baseline. The interface rounds these to 7.6% and 11.5%. These are measured error rates on synthetic data and cannot establish expected performance on real sales.

The detailed product MAE, RMSE, WAPE, baseline metrics, selected methods, and range coverage are recorded in project/evaluation.json. The notebook independently reproduces those results.

## 7. Planning ranges and uncertainty

For the selected model, the range radius is the 80th percentile of the 56 absolute validation errors, using the higher empirical quantile. Future lower bounds equal max(0, forecast − radius), and upper bounds equal forecast + radius. The width is constant across forecast horizons; it is an illustrative planning range rather than a fully specified probabilistic model.

Coverage is evaluated on the independent final test as the fraction of actual daily quantities inside these per-product bounds. The demo mean coverage is **82.142857%** across the 168 product/day test observations. Future coverage may differ because sales distributions change, errors are time-dependent, and longer horizons have different uncertainty.

Portfolio bounds are sums of the product bounds. They provide a planning envelope, not an 80% aggregate confidence interval. The app does not assume independent product errors to manufacture a precise aggregate probability.

## 8. Revenue and inventory calculations

Historical revenue is observed units multiplied by recorded prices, summed for the latest 30 days. It is unavailable if positive-unit observations in the selected window lack prices. Future sales value holds the latest available unit price constant for each product and multiplies it by forecast units. It is an estimate, and no predicted price change or currency conversion is included.

Users enter available stock, lead time from 1 to 90 days, and safety cover from 0 to 30 days. Target cover is the cumulative point forecast over lead time plus safety-cover days. Estimated order quantity is ceil(max(0, target cover − available stock)). A product is flagged Order now when stock is below expected lead-time demand, Reorder soon when an order is needed to reach the full cover target, and Stock covered when no positive order estimate remains. Missing stock is treated as unknown, not as zero inventory.

Estimated stockout is the first forecast day whose cumulative sales exceed available stock, assuming no replenishment. This identifies the first day with insufficient forecast coverage. Dates are reported only within the selected horizon. Incoming purchase orders, supplier uncertainty, service-level optimisation, storage constraints, and minimum order quantities are not included. Safety days are user assumptions, rather than a calibrated statistical safety-stock policy.

## 9. Architecture

| Component | Responsibility |
| --- | --- |
| CSV parser | Validate dates, numeric fields, duplicates, continuity, minimum history, and aligned final dates |
| Browser worker | Fit candidate models, run chronological evaluation, select a method, and refit on observed history |
| Forecast engine | Produce 180 daily predictions, planning bounds, test metrics, and portfolio totals |
| UI | Show product/horizon filters, charts, backtests, model comparisons, and import messages |
| Inventory planner | Calculate stock-cover targets, order estimates, and stockout dates from user settings |
| Exports | Download daily forecasts and stock plans as CSV |
| Python pipeline | Generate demo data and independently train/evaluate the scikit-learn models |

The app uses native JavaScript modules, a module worker, and interactive SVG charts. No forecasting API key or remote model service is required. It can be served locally with python -m http.server 8000 --directory dist.

## 10. Verification and reproducibility

The automated checks compare browser coefficients, the first 30 future predictions for all six products, final-test predictions, WAPE, and range radii with independent scikit-learn outputs. Maximum forecast differences are below 0.0000001 units. The checks also change all final-test targets and confirm that earlier model selection and held-out predictions stay unchanged.

Further tests cover non-negative forecasts, a constant-demand baseline, an all-zero series with undefined WAPE, missing dates, invalid dates, negative values, missing columns, unclosed quotes, duplicate aggregation, correct inventory order quantities and stockout dates, portfolio totals, and the number of exported forecast rows. Browser QA exercises filters, chart modes, model selection, inventory editing, import feedback, and export controls.

## 11. Suggested experiments

1. Compare calendar regression and the weekly baseline using validation and held-out errors. Explain why a simple method can still be valuable.
2. Compare 14-, 30-, 60-, and 90-day views. Identify which horizons have direct evaluation evidence.
3. Increase lead time while holding available stock constant. Explain how cumulative forecast demand changes the order estimate.
4. Remove a date from a CSV, attempt import, and explain why a missing observation should not automatically become zero sales.
5. Import a continuous real dataset, compare product-level WAPE with the demo, and inspect whether promotions or stockouts explain errors.

## 12. Sources

- scikit-learn, Ridge regression: https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Ridge.html
- scikit-learn, Time series cross-validation: https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split
- Included generation code, environment versions, independent evaluation outputs, and executable parity tests.
