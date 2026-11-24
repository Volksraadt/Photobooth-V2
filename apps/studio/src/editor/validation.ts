'use client';

import {
  validateBoothConfig,
  type BoothConfig,
  type PageType,
  type ValidationIssue,
} from '@pb/schema';
import { useDeferredValue, useMemo } from 'react';
import { useEditor } from './editor-context';

export type IssueGroups = {
  all: ValidationIssue[];
  byPage: Partial<Record<PageType, ValidationIssue[]>>;
  byFrame: Record<string, ValidationIssue[]>;
  other: ValidationIssue[];
};

export function groupIssues(doc: BoothConfig, issues: ValidationIssue[]): IssueGroups {
  const groups: IssueGroups = { all: issues, byPage: {}, byFrame: {}, other: [] };
  for (const issue of issues) {
    const page = /^pages\.(\w+)/.exec(issue.path)?.[1] as PageType | undefined;
    const frameIdx = /^frames\.(\d+)/.exec(issue.path)?.[1];
    if (page) (groups.byPage[page] ??= []).push(issue);
    else if (frameIdx !== undefined) {
      const id = doc.frames[Number(frameIdx)]?.id ?? frameIdx;
      (groups.byFrame[id] ??= []).push(issue);
    } else groups.other.push(issue);
  }
  return groups;
}

/** Element id referenced by an issue path (`pages.capture.elements.3…`). */
export function issueElementId(
  doc: BoothConfig,
  issue: ValidationIssue,
): { page: PageType; id: string } | null {
  const m = /^pages\.(\w+)\.(?:slides\.(\d+)\.)?elements\.(\d+)/.exec(issue.path);
  if (!m) return null;
  const page = m[1] as PageType;
  const p = doc.pages[page];
  const list = m[2] !== undefined ? p.slides?.[Number(m[2])]?.elements : p.elements;
  const el = list?.[Number(m[3])];
  return el ? { page, id: el.id } : null;
}

/** Validation of the live document (deferred so typing/dragging stays smooth). */
export function useValidation(): IssueGroups {
  const doc = useEditor((s) => s.doc);
  const deferred = useDeferredValue(doc);
  return useMemo(() => {
    const result = validateBoothConfig(deferred);
    return groupIssues(deferred, result.success ? [] : result.issues);
  }, [deferred]);
}
