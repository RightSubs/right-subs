package com.rightsubs.android

/**
 * Minimal QR Code encoder (ISO/IEC 18004): byte mode, error correction level M, versions
 * 1–10 (up to 213 bytes) — enough for the phone-setup address. Same structure as Project
 * Nayuki's reference implementation, without the other modes and levels.
 */
class QrCode private constructor(val size: Int, private val modules: Array<BooleanArray>) {
    /** True for a dark module; [x] is the column and [y] the row. */
    fun isDark(x: Int, y: Int): Boolean = modules[y][x]

    companion object {
        private const val MAX_VERSION = 10
        /** Level M, by version (index 0 unused). */
        private val ECC_PER_BLOCK = intArrayOf(-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26)
        private val BLOCKS = intArrayOf(-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5)
        /** Format bits of level M. */
        private const val LEVEL_M = 0

        fun encode(text: String): QrCode {
            val data = text.toByteArray(Charsets.UTF_8)
            val version = (1..MAX_VERSION).firstOrNull { 4 + countBits(it) + data.size * 8 <= dataCodewords(it) * 8 }
                ?: throw IllegalArgumentException("texto longo demais para o QR: ${data.size} bytes")

            val bits = Bits()
            bits.append(0b0100, 4) // byte mode
            bits.append(data.size, countBits(version))
            for (byte in data) bits.append(byte.toInt() and 0xFF, 8)
            val capacity = dataCodewords(version) * 8
            bits.append(0, minOf(4, capacity - bits.size)) // terminator
            bits.append(0, (8 - bits.size % 8) % 8)
            var pad = 0xEC
            while (bits.size < capacity) {
                bits.append(pad, 8)
                pad = pad xor 0xEC xor 0x11
            }

            val matrix = Matrix(version)
            matrix.drawFunctionPatterns()
            matrix.drawCodewords(withErrorCorrection(bits.toCodewords(), version))
            // Any mask decodes; the lowest penalty is the easiest for cameras.
            val mask = (0..7).minByOrNull { candidate ->
                matrix.applyMask(candidate)
                matrix.drawFormatBits(candidate)
                matrix.penalty().also { matrix.applyMask(candidate) } // XOR again undoes it
            } ?: 0
            matrix.applyMask(mask)
            matrix.drawFormatBits(mask)
            return QrCode(matrix.size, matrix.modules)
        }

        private fun countBits(version: Int) = if (version <= 9) 8 else 16

        /** Modules left for data and error correction once the function patterns are drawn. */
        private fun rawModules(version: Int): Int {
            var result = (16 * version + 128) * version + 64
            if (version >= 2) {
                val align = version / 7 + 2
                result -= (25 * align - 10) * align - 55
                if (version >= 7) result -= 36
            }
            return result
        }

        private fun dataCodewords(version: Int) = rawModules(version) / 8 - ECC_PER_BLOCK[version] * BLOCKS[version]

        /** Splits the data into blocks, appends each block's Reed-Solomon bytes and interleaves them. */
        private fun withErrorCorrection(data: IntArray, version: Int): IntArray {
            val blocks = BLOCKS[version]
            val eccLength = ECC_PER_BLOCK[version]
            val raw = rawModules(version) / 8
            val shortBlocks = blocks - raw % blocks
            val shortLength = raw / blocks
            val divisor = reedSolomonDivisor(eccLength)
            var offset = 0
            val all = (0 until blocks).map { index ->
                val dataLength = shortLength - eccLength + if (index < shortBlocks) 0 else 1
                val chunk = data.copyOfRange(offset, offset + dataLength)
                offset += dataLength
                // Short blocks get a dummy byte so every block has the same layout.
                val block = chunk.copyOf(shortLength + 1)
                reedSolomonRemainder(chunk, divisor).copyInto(block, block.size - eccLength)
                block
            }
            val result = ArrayList<Int>(raw)
            for (i in 0 until shortLength + 1) {
                all.forEachIndexed { index, block -> if (i != shortLength - eccLength || index >= shortBlocks) result += block[i] }
            }
            return result.toIntArray()
        }

        private fun reedSolomonDivisor(degree: Int): IntArray {
            val result = IntArray(degree)
            result[degree - 1] = 1
            var root = 1
            repeat(degree) {
                for (j in 0 until degree) {
                    result[j] = gfMultiply(result[j], root)
                    if (j + 1 < degree) result[j] = result[j] xor result[j + 1]
                }
                root = gfMultiply(root, 0x02)
            }
            return result
        }

        private fun reedSolomonRemainder(data: IntArray, divisor: IntArray): IntArray {
            val result = IntArray(divisor.size)
            for (byte in data) {
                val factor = byte xor result[0]
                result.copyInto(result, 0, 1)
                result[result.size - 1] = 0
                for (i in result.indices) result[i] = result[i] xor gfMultiply(divisor[i], factor)
            }
            return result
        }

        /** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
        private fun gfMultiply(x: Int, y: Int): Int {
            var z = 0
            for (i in 7 downTo 0) {
                z = (z shl 1) xor ((z ushr 7) * 0x11D)
                z = z xor (((y ushr i) and 1) * x)
            }
            return z
        }
    }

    private class Bits {
        private val bits = ArrayList<Boolean>()
        val size get() = bits.size

        fun append(value: Int, length: Int) {
            for (i in length - 1 downTo 0) bits += ((value ushr i) and 1) == 1
        }

        fun toCodewords() = IntArray(bits.size / 8) { i -> (0 until 8).fold(0) { acc, j -> (acc shl 1) or if (bits[i * 8 + j]) 1 else 0 } }
    }

    private class Matrix(private val version: Int) {
        val size = version * 4 + 17
        val modules = Array(size) { BooleanArray(size) }
        private val isFunction = Array(size) { BooleanArray(size) }

        private fun setFunction(x: Int, y: Int, dark: Boolean) {
            modules[y][x] = dark
            isFunction[y][x] = true
        }

        fun drawFunctionPatterns() {
            for (i in 0 until size) {
                setFunction(6, i, i % 2 == 0)
                setFunction(i, 6, i % 2 == 0)
            }
            drawFinder(3, 3)
            drawFinder(size - 4, 3)
            drawFinder(3, size - 4)
            val align = alignmentPositions()
            val last = align.size - 1
            for (i in align.indices) {
                for (j in align.indices) {
                    // The three corners already hold finder patterns.
                    if (!((i == 0 && j == 0) || (i == 0 && j == last) || (i == last && j == 0))) drawAlignment(align[i], align[j])
                }
            }
            drawFormatBits(0) // reserves the area; redrawn with the chosen mask
            drawVersion()
        }

        private fun drawFinder(x: Int, y: Int) {
            for (dy in -4..4) {
                for (dx in -4..4) {
                    val distance = maxOf(kotlin.math.abs(dx), kotlin.math.abs(dy))
                    val xx = x + dx
                    val yy = y + dy
                    if (xx in 0 until size && yy in 0 until size) setFunction(xx, yy, distance != 2 && distance != 4)
                }
            }
        }

        private fun drawAlignment(x: Int, y: Int) {
            for (dy in -2..2) for (dx in -2..2) setFunction(x + dx, y + dy, maxOf(kotlin.math.abs(dx), kotlin.math.abs(dy)) != 1)
        }

        private fun alignmentPositions(): IntArray {
            if (version == 1) return IntArray(0)
            val count = version / 7 + 2
            val step = (version * 8 + count * 3 + 5) / (count * 4 - 4) * 2
            val result = IntArray(count)
            result[0] = 6
            var position = size - 7
            for (i in count - 1 downTo 1) {
                result[i] = position
                position -= step
            }
            return result
        }

        fun drawFormatBits(mask: Int) {
            val data = LEVEL_M shl 3 or mask
            var remainder = data
            repeat(10) { remainder = (remainder shl 1) xor ((remainder ushr 9) * 0x537) }
            val bits = (data shl 10 or remainder) xor 0x5412
            fun bit(i: Int) = ((bits ushr i) and 1) == 1
            for (i in 0..5) setFunction(8, i, bit(i))
            setFunction(8, 7, bit(6))
            setFunction(8, 8, bit(7))
            setFunction(7, 8, bit(8))
            for (i in 9..14) setFunction(14 - i, 8, bit(i))
            for (i in 0..7) setFunction(size - 1 - i, 8, bit(i))
            for (i in 8..14) setFunction(8, size - 15 + i, bit(i))
            setFunction(8, size - 8, true) // always dark
        }

        private fun drawVersion() {
            if (version < 7) return
            var remainder = version
            repeat(12) { remainder = (remainder shl 1) xor ((remainder ushr 11) * 0x1F25) }
            val bits = version shl 12 or remainder
            for (i in 0..17) {
                val dark = ((bits ushr i) and 1) == 1
                val a = size - 11 + i % 3
                val b = i / 3
                setFunction(a, b, dark)
                setFunction(b, a, dark)
            }
        }

        /** Zigzag from the bottom-right corner, two columns at a time, skipping the timing column. */
        fun drawCodewords(codewords: IntArray) {
            var i = 0
            var right = size - 1
            while (right >= 1) {
                if (right == 6) right = 5
                for (vertical in 0 until size) {
                    for (j in 0..1) {
                        val x = right - j
                        val upward = ((right + 1) and 2) == 0
                        val y = if (upward) size - 1 - vertical else vertical
                        if (!isFunction[y][x] && i < codewords.size * 8) {
                            modules[y][x] = ((codewords[i ushr 3] ushr (7 - (i and 7))) and 1) == 1
                            i++
                        }
                    }
                }
                right -= 2
            }
        }

        fun applyMask(mask: Int) {
            for (y in 0 until size) {
                for (x in 0 until size) {
                    if (isFunction[y][x]) continue
                    val invert = when (mask) {
                        0 -> (x + y) % 2 == 0
                        1 -> y % 2 == 0
                        2 -> x % 3 == 0
                        3 -> (x + y) % 3 == 0
                        4 -> (x / 3 + y / 2) % 2 == 0
                        5 -> x * y % 2 + x * y % 3 == 0
                        6 -> (x * y % 2 + x * y % 3) % 2 == 0
                        else -> ((x + y) % 2 + x * y % 3) % 2 == 0
                    }
                    if (invert) modules[y][x] = !modules[y][x]
                }
            }
        }

        /** The standard's four penalty rules (runs, 2×2 blocks, finder look-alikes, balance). */
        fun penalty(): Int {
            var result = 0
            val lines = (0 until size).map { y -> BooleanArray(size) { x -> modules[y][x] } } +
                (0 until size).map { x -> BooleanArray(size) { y -> modules[y][x] } }
            val finder = booleanArrayOf(true, false, true, true, true, false, true)
            for (line in lines) {
                var run = 1
                for (i in 1..size) {
                    if (i < size && line[i] == line[i - 1]) {
                        run++
                    } else {
                        if (run >= 5) result += 3 + run - 5
                        run = 1
                    }
                }
                for (start in 0..size - 7) {
                    if ((0 until 7).all { line[start + it] == finder[it] }) {
                        val before = (start - 4 until start).all { it < 0 || !line[it] }
                        val after = (start + 7 until start + 11).all { it >= size || !line[it] }
                        if (before || after) result += 40
                    }
                }
            }
            for (y in 0 until size - 1) {
                for (x in 0 until size - 1) {
                    val color = modules[y][x]
                    if (color == modules[y][x + 1] && color == modules[y + 1][x] && color == modules[y + 1][x + 1]) result += 3
                }
            }
            val total = size * size
            val dark = modules.sumOf { row -> row.count { it } }
            result += ((kotlin.math.abs(dark * 20 - total * 10) + total - 1) / total - 1) * 10
            return result
        }
    }
}
