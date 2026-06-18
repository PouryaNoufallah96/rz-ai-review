# Frontend Review Context

<!-- rz-review:generated:start -->
## Detected Frontend Signals

- Static public assets

## Review Focus

- Check responsive layout for narrow and desktop viewports when UI files change.
- Flag fixed-width layouts, overflowing text, missing loading/error states, and inaccessible interactive controls.
- Prefer existing UI patterns and assets over adding unrelated visual systems.
- When no frontend framework is detected, treat public assets as static UI and keep changes simple.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Frontend Notes

Frontend review is a first-class use case for Target Projects, even though this repository only has a small static UI.

When frontend files change in a Target Project, prefer concrete findings about:

- Layout overflow on narrow screens.
- Fixed dimensions that block responsive behavior.
- Missing loading, empty, and error states.
- Inaccessible interactive controls.
- UI behavior that conflicts with the Target Project's own design system.

Do not post generic responsive-design advice without changed-code evidence.
<!-- rz-review:human:end -->
