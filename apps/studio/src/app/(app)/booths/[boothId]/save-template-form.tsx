'use client';

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@pb/ui';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { saveBoothAsTemplateAction } from '../../admin/templates/actions';

/** Platform admins only: turn this booth's current design (draft) into a template. */
export function SaveTemplateForm({ boothId, boothName }: { boothId: string; boothName: string }) {
  const [name, setName] = useState(boothName);
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <Card data-testid="save-template">
      <CardHeader>
        <CardTitle className="text-base">Simpan sebagai template</CardTitle>
        <CardDescription>
          Khusus admin platform. Desain draft booth ini (halaman, frame, filter, alur) menjadi
          template di galeri “Buat booth” semua owner. PIN admin, ID booth, dan kredensial
          pembayaran tidak ikut.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="tpl-name">Nama template</Label>
            <Input
              id="tpl-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tpl-desc">Deskripsi (opsional)</Label>
            <Input
              id="tpl-desc"
              value={description}
              maxLength={200}
              placeholder="mis. Pastel, kamera di kiri"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          disabled={busy || !name.trim()}
          data-testid="save-template-submit"
          onClick={() =>
            start(async () => {
              setResult(
                await saveBoothAsTemplateAction({ boothId, name: name.trim(), description }),
              );
            })
          }
        >
          {busy ? 'Menyimpan…' : 'Simpan sebagai template'}
        </Button>
        {result?.ok && (
          <Alert variant="success">
            Template tersimpan. Kelola di{' '}
            <Link href="/admin/templates" className="underline">
              Admin → Template
            </Link>
            .
          </Alert>
        )}
        {result && !result.ok && <Alert variant="destructive">{result.message}</Alert>}
      </CardContent>
    </Card>
  );
}
