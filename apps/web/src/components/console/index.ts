/**
 * Console UI kit — cohesive, light-SaaS admin/coach/partner components built on
 * the design tokens in globals.css. Import from '@/components/console'.
 *
 * Server-component friendly: PageHeader, SectionHeader, Card, CardHeader,
 * StatTile, Badge, TierChip, StatusChip, TierBadge, StatusDot, InlineAlert,
 * DetailList, DetailRow, DataTable, TableThumb, SkeletonBar, SkeletonRows,
 * SkeletonTiles, EmptyState, Toolbar, ChartCard, GaugeArc, HeatGrid, NavIcon.
 * Client ('use client'): Button, FilterPill, FilterPills, TextField,
 * SearchField, Drawer, Modal, PanelHeader, ConfirmButton, ConsoleShell,
 * SidebarNav, TopBar.
 */
export { PageHeader } from './PageHeader';
export { SectionHeader } from './SectionHeader';
export { Card, CardHeader } from './Card';
export { StatTile } from './StatTile';
export { Badge, TierChip, StatusChip } from './Badge';
export { TierBadge } from './TierBadge';
export { StatusDot } from './StatusDot';
export type { StatusDotTone } from './StatusDot';
export { InlineAlert } from './InlineAlert';
export { DetailList, DetailRow } from './DetailList';
export { Button } from './Button';
export { FilterPill, FilterPills } from './FilterPill';
export { TextField, SearchField } from './TextField';
export { DataTable, TableThumb } from './DataTable';
export type { Column } from './DataTable';
export { SkeletonBar, SkeletonRows, SkeletonTiles } from './Skeleton';
export { EmptyState } from './EmptyState';
export { Toolbar } from './Toolbar';
export { Drawer } from './Drawer';
export { Modal } from './Modal';
export { PanelHeader } from './PanelHeader';
export { ConfirmButton } from './ConfirmButton';
export { ConsoleShell } from './ConsoleShell';
export { SidebarNav } from './SidebarNav';
export type { NavItem, NavGroup } from './SidebarNav';
export { TopBar } from './TopBar';
export { LogoutButton } from './LogoutButton';
export { NavIcon } from './NavIcons';
export type { NavIconName } from './NavIcons';
// Dataviz (pure SVG/CSS, no chart library).
export { ChartCard } from './ChartCard';
export type { ChartPoint } from './ChartCard';
export { GaugeArc } from './GaugeArc';
export { HeatGrid } from './HeatGrid';
export type { HeatRow } from './HeatGrid';
export * as chart from './chart';
