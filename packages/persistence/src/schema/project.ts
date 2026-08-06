import { sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

export const projectTable = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const repositoryRevisionTable = sqliteTable(
  'repository_revision',
  {
    id: text('id').primaryKey(),
    baseCommit: text('base_commit').notNull(),
    treeHash: text('tree_hash').notNull(),
    workingTreePatchHash: text('working_tree_patch_hash'),
    createdAt: text('created_at').notNull()
  },
  (t) => [unique('repository_revision_unique').on(t.baseCommit, t.treeHash, t.workingTreePatchHash)]
)

export type ProjectRow = typeof projectTable.$inferSelect
export type RepositoryRevisionRow = typeof repositoryRevisionTable.$inferSelect
