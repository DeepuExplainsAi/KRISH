package app.krish.agent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalDownloadPolicyTest {
    @Test fun allowsOnlyHuggingFaceAndHfSubdomainsOverTls() {
        listOf("https://huggingface.co/a", "https://cas-bridge.xethub.hf.co/a?sig=abc", "https://us.aws.cdn.hf.co:443/file", "HTTPS://HF.HF.CO/file")
            .forEach { assertTrue(it, LocalDownloadPolicy.allowed(it)) }
        listOf("http://huggingface.co/a", "https://hf.co/a", "https://evil-hf.co/a", "https://hf.co.evil.test/a", "https://huggingface.co.evil.test/a", "https://huggingface.co:444/a", "https://u:p@huggingface.co/a", "https://huggingface.co/a#fragment", "https://127.0.0.1/a", "not a url")
            .forEach { assertFalse(it, LocalDownloadPolicy.allowed(it)) }
    }
}
