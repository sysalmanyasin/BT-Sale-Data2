package com.duapharma.mailroutine.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration

@Database(
    entities = [RoutineEntity::class, OccurrenceEntity::class, AttemptEntity::class],
    version = AppDatabase.VERSION,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun routines(): RoutineDao
    abstract fun occurrences(): OccurrenceDao
    abstract fun attempts(): AttemptDao

    companion object {
        const val VERSION = 1

        fun build(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "mailroutine.db")
                .addMigrations(*Migrations.ALL.toTypedArray())
                // No fallbackToDestructiveMigration(): losing history could re-enable duplicate sends.
                .build()
    }
}

/**
 * Every schema bump must add a Migration(from, to) here. MigrationChainTest fails the build if a
 * version is skipped, and androidTest/MigrationInstrumentedTest exercises real upgrades.
 */
object Migrations {
    val ALL: List<Migration> = emptyList() // schema v1 is the first release
}
