import * as React from 'react';

export const DetailsDialog = React.lazy(() => import('@/components/dialogs/DetailsDialog').then((module) => ({ default: module.DetailsDialog })));
export const QueueDialog = React.lazy(() => import('@/components/dialogs/QueueDialog').then((module) => ({ default: module.QueueDialog })));
export const LoginDialogV2 = React.lazy(() => import('@/components/dialogs/LoginDialog').then((module) => ({ default: module.LoginDialogV2 })));
export const VideoDialog = React.lazy(() => import('@/components/dialogs/VideoDialog').then((module) => ({ default: module.VideoDialog })));
export const SettingsDialog = React.lazy(() => import('@/components/dialogs/SettingsDialog').then((module) => ({ default: module.SettingsDialog })));
