/**
 * @retailos/ui — the shared design system for merchant-web and storefront-web.
 *
 * Consumed as TypeScript source via Next's `transpilePackages`, so there is no
 * build step to keep in sync and `'use client'` directives survive intact.
 *
 * Import the token stylesheet once per app:
 *   import '@retailos/ui/styles.css';
 */
export { cn } from './lib/cn';

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './primitives/button';
export {
  Field,
  Input,
  Textarea,
  Select,
  Checkbox,
  Switch,
  type FieldProps,
  type InputProps,
  type TextareaProps,
  type SelectProps,
  type CheckboxProps,
  type SwitchProps,
} from './primitives/field';
export {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Badge,
  Avatar,
  Skeleton,
  SkeletonRows,
  Spinner,
  EmptyState,
  ErrorState,
  type CardProps,
  type BadgeProps,
  type BadgeTone,
  type AvatarProps,
  type EmptyStateProps,
  type ErrorStateProps,
} from './primitives/surfaces';
export {
  Modal,
  Drawer,
  ToastProvider,
  useToast,
  ConfirmDialog,
  type ModalProps,
  type DrawerProps,
  type Toast,
  type ToastTone,
  type ConfirmDialogProps,
} from './primitives/overlays';
export {
  Tabs,
  Dropdown,
  SegmentedControl,
  PageHeader,
  Accordion,
  type TabItem,
  type TabsProps,
  type DropdownItem,
  type DropdownProps,
  type SegmentOption,
  type PageHeaderProps,
} from './primitives/navigation';

export { DataTable, Pagination, type Column, type DataTableProps, type PaginationProps } from './data/table';

export { AreaChart, type AreaPoint, type AreaChartProps } from './charts/area-chart';
export { BarList, Sparkline, type BarListItem, type BarListProps } from './charts/bar-list';
export { StatTile, type StatTileProps } from './charts/stat-tile';
