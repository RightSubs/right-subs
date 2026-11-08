package com.rightsubs.android

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/** The app speaks English (default) and Portuguese: both must say everything, with the same placeholders. */
class StringsTest {
    private fun strings(dir: String): Map<String, String> {
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File("src/main/res/$dir/strings.xml"))
        val nodes = document.getElementsByTagName("string")
        return (0 until nodes.length).map { nodes.item(it) }
            .filter { it.attributes.getNamedItem("translatable")?.nodeValue != "false" }
            .associate { it.attributes.getNamedItem("name").nodeValue to it.textContent }
    }

    private val english = strings("values")
    private val portuguese = strings("values-pt")
    private fun placeholders(text: String) = Regex("%\\d\\$[sd]").findAll(text).map { it.value }.sorted().toList()

    @Test
    fun portugueseHasEveryStringAndNoOther() {
        assertEquals(english.keys.sorted(), portuguese.keys.sorted())
    }

    @Test
    fun placeholdersMatch() {
        for ((name, text) in english) {
            assertEquals(name, placeholders(text), placeholders(portuguese[name].orEmpty()))
        }
    }

    @Test
    fun everyCredentialErrorHasItsOwnText() {
        val errors = CredentialError.values()
        assertEquals(errors.size, errors.map { it.message }.toSet().size)
        assertEquals(errors.size, english.keys.count { it.startsWith("error_") })
    }
}
