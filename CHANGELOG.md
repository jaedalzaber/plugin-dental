# Changelog

## 0.2.0

- Now a package plugin: it loads from its own folder, has its own routes (`/api/v1/ext/dental/`), database migration, texts and admin screens, and stays off until a business switches it on.
- The daily recall and history review tasks skip businesses that have not switched the plugin on.
- Choosing the Dental clinic business type adds the starter pack; the demo install builds the Smile Dental Clinic sample data.
- Adds a recall route for the reports dashboard.

## 0.1.0

- Medical history, insurance, consent per service, dental chart, procedures, treatment plans, recall and the starter pack, built into the main app.
