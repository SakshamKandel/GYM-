/**
 * Console UI kit — cohesive, dark, dense admin/coach components built on the
 * design tokens in globals.css. Import from '@/components/console'.
 *
 * Server-component friendly: PageHeader, Card, CardHeader, StatTile, Badge,
 * TierChip, StatusChip, DataTable, SkeletonBar, SkeletonRows, EmptyState,
 * Toolbar. Client ('use client'): Button, TextField, SearchField, Drawer,
 * Modal, ConfirmButton.
 */
export { PageHeader } from './PageHeader';
export { Card, CardHeader } from './Card';
export { StatTile } from './StatTile';
export { Badge, TierChip, StatusChip } from './Badge';
export { Button } from './Button';
export { TextField, SearchField } from './TextField';
export { DataTable } from './DataTable';
export type { Column } from './DataTable';
export { SkeletonBar, SkeletonRows } from './Skeleton';
export { EmptyState } from './EmptyState';
export { Toolbar } from './Toolbar';
export { Drawer } from './Drawer';
export { Modal } from './Modal';
export { ConfirmButton } from './ConfirmButton';
export { ConsoleShell } from './ConsoleShell';
export type { NavItem } from './ConsoleShell';
export { LogoutButton } from './LogoutButton';
