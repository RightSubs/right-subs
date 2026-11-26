package com.rightsubs.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundRunTest {
    @Test
    fun asksOnAPhoneThatStillRestrictsTheApp() {
        assertTrue(BackgroundRun.shouldAsk(isTv = false, ignoringOptimizations = false, alreadyAsked = false))
    }

    @Test
    fun asksOnlyOnce() {
        assertFalse(BackgroundRun.shouldAsk(isTv = false, ignoringOptimizations = false, alreadyAsked = true))
    }

    @Test
    fun doesNotAskWhenTheAppIsAlreadyExempt() {
        assertFalse(BackgroundRun.shouldAsk(isTv = false, ignoringOptimizations = true, alreadyAsked = false))
    }

    @Test
    fun neverAsksOnATvBox() {
        assertFalse(BackgroundRun.shouldAsk(isTv = true, ignoringOptimizations = false, alreadyAsked = false))
    }
}
