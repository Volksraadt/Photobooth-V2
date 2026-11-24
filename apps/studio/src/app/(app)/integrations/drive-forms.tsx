'use client';

import { Button, Input, Label } from '@pb/ui';
import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { IDLE } from '@/lib/form';
import {
  connectDriveAction,
  disconnectDriveAction,
  setRootFolderAction,
  testDriveAction,
} from './drive-actions';

export type DriveFolderOption = { id: string; name: string };

export function ConnectDriveButton({ reconnect }: { reconnect: boolean }) {
  const [state, action, pending] = useActionState(connectDriveAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" disabled={pending} data-testid="drive-connect">
        {pending
          ? 'Membuka Google…'
          : reconnect
            ? 'Hubungkan ulang Google Drive'
            : 'Hubungkan Google Drive'}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function TestDriveButton() {
  const [state, action, pending] = useActionState(testDriveAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="outline" disabled={pending} data-testid="drive-test">
        {pending ? 'Menguji…' : 'Tes koneksi'}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function DisconnectDriveButton() {
  const [state, action, pending] = useActionState(disconnectDriveAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="outline" disabled={pending} data-testid="drive-disconnect">
        Putuskan
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function RootFolderForm({
  folders,
  currentId,
}: {
  folders: DriveFolderOption[];
  currentId: string | null;
}) {
  const [state, action, pending] = useActionState(setRootFolderAction, IDLE);
  return (
    <div className="space-y-4" data-testid="drive-root-folder">
      {folders.length > 0 && (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="mode" value="existing" />
          <div className="space-y-1">
            <Label htmlFor="drive-folder-existing">Pakai folder yang sudah ada</Label>
            <select
              id="drive-folder-existing"
              name="folderId"
              defaultValue={currentId ?? ''}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Pakai folder ini
          </Button>
        </form>
      )}
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="mode" value="create" />
        <div className="space-y-1">
          <Label htmlFor="drive-folder-new">Atau buat folder baru</Label>
          <Input
            id="drive-folder-new"
            name="name"
            placeholder="Photobooth"
            maxLength={100}
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Buat folder
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Aplikasi hanya dapat melihat folder yang dibuatnya sendiri (izin <code>drive.file</code>),
        jadi folder lama Anda tidak muncul di daftar. Buat folder baru di sini.
      </p>
      <FormMessage state={state} />
    </div>
  );
}
