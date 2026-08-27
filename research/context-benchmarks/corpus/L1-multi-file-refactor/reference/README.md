# L1 multi-file signature refactor

CommonJS inventory/order system. `formatPrice(amount, currency)` in `utils/format.js`
is called from models, services, and the index facade. The tests in `test/` are
written against a new options-based contract for `formatPrice`; the source still
uses the legacy two-argument signature everywhere.
