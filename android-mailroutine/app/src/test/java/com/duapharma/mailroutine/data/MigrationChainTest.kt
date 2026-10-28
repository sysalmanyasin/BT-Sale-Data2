package com.duapharma.mailroutine.data

import org.junit.Assert.*
import org.junit.Test

/**
 * Guards against shipping a schema bump without a migration: every version step from 1 to the
 * current VERSION must have exactly one registered Migration. (Real SQLite upgrades are exercised
 * by androidTest/MigrationInstrumentedTest, which needs an emulator and therefore isn't part of CI.)
 */
class MigrationChainTest {
    @Test fun everyVersionStepHasExactlyOneMigration() {
        for (from in 1 until AppDatabase.VERSION) {
            val steps = Migrations.ALL.filter { it.startVersion == from && it.endVersion == from + 1 }
            assertEquals("Missing or duplicate migration $from -> ${from + 1}", 1, steps.size)
        }
    }

    @Test fun noMigrationJumpsBackwardsOrBeyondCurrent() {
        Migrations.ALL.forEach {
            assertTrue(it.endVersion > it.startVersion)
            assertTrue(it.endVersion <= AppDatabase.VERSION)
        }
    }

    @Test fun schemaVersionIsAtLeastOne() = assertTrue(AppDatabase.VERSION >= 1)
}
