import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,check} from 'drizzle-orm/sqlite-core';
export const studentAccounts=sqliteTable('student_accounts',{
 ownerId:text('owner_id').primaryKey().notNull(),
 displayName:text('display_name').notNull(),
 studyGroup:text('study_group').notNull().default(''),
 stateJson:text('state_json').notNull(),
 revision:integer('revision').notNull().default(1),
 createdAt:text('created_at').notNull(),
 updatedAt:text('updated_at').notNull()
},table=>[check('student_accounts_revision_positive',sql`${table.revision} >= 1`)]);
