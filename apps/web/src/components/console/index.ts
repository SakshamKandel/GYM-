/**
 * Console UI kit — cohesive, light-SaaS admin/coach/partner components built on
 * the design tokens in globals.css. Import from '@/components/console'.
 *
 * Server-component friendly: PageHeader, Card, CardHeader, StatTile, Badge,
 * TierChip, StatusChip, TierBadge, DataTable, TableThumb, SkeletonBar,
 * SkeletonRows, EmptyState, Toolbar, ChartCard, GaugeArc, HeatGrid.
 * Client ('use client'): Button, TextField, SearchField, Drawer, Modal,
 * ConfirmButton, ConsoleShell, SidebarNav, TopBar.
 */
export { PageHeader } from './PageHeader';
export { Card, CardHeader } from './Card';
export { StatTile } from './StatTile';
export { Badge, TierChip, StatusChip } from './Badge';
export { TierBadge } from './TierBadge';
export { Button } from './Button';
export { TextField, SearchField } from './TextField';
export { DataTable, TableThumb } from './DataTable';
export type { Column } from './DataTable';
export { SkeletonBar, SkeletonRows } from './Skeleton';
export { EmptyState } from './EmptyState';
export { Toolbar } from './Toolbar';
export { Drawer } from './Drawer';
export { Modal } from './Modal';
export { ConfirmButton } from './ConfirmButton';
export { ConsoleShell } from './ConsoleShell';
export { SidebarNav } from './SidebarNav';
export type { NavItem, NavGroup } from './SidebarNav';
export { TopBar } from './TopBar';
export { LogoutButton } from './LogoutButton';
// Dataviz (pure SVG/CSS, no chart library).
export { ChartCard } from './ChartCard';
export type { ChartPoint } from './ChartCard';
export { GaugeArc } from './GaugeArc';
export { HeatGrid } from './HeatGrid';
export type { HeatRow } from './HeatGrid';
export * as chart from './chart';
