/**
 * The design-system primitives (FR-EK-C.2).
 *
 * Banner, Dropdown, Modal and Panel — the four overlay/notice shapes the app
 * had grown one-off copies of — live here so every screen consumes the same
 * behaviour rather than re-deriving it. Import from `components/ui`, not the
 * individual files, so the surface stays a single seam.
 */
export { Banner, bannerDismissKey, type BannerTone } from './Banner.js';
export {
  ConditionFilters,
  type Condition,
  type ConditionFieldDef,
  type ConditionFieldOption,
  type ConditionFiltersLabels,
} from './ConditionFilters.js';
export { Dropdown } from './Dropdown.js';
export { Modal } from './Modal.js';
export { Panel, PanelSection } from './Panel.js';
export { cn } from './cn.js';
