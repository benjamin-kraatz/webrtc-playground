import type React from 'react';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export type SectionId =
  | 'fundamentals'
  | 'media'
  | 'datachannels'
  | 'audiovideo'
  | 'advanced'
  | 'multiparty'
  | 'cuttingedge'
  | 'games'
  | 'mashups';

export interface DemoMeta {
  id: string;
  title: string;
  path: string;
  section: SectionId;
  difficulty: Difficulty;
  description: string;
  tags: string[];
  needsServer: boolean;
  needsMultipleTabs: boolean;
  component: React.LazyExoticComponent<React.FC>;
}

export interface SectionMeta {
  id: SectionId;
  title: string;
  icon: string;
}
