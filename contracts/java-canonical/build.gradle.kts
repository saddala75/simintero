// Platform replacement for the deleted services/enstellar-packages/canonical-model
// Gradle module. Compiles the platform-generated Java canonical model
// (package com.simintero.enstellar.canonical, produced by contracts/codegen/generate.py)
// into the SAME artifact coordinates the old Enstellar module published, so that
// services/enstellar-interop's composite build substitution still resolves
// com.simintero.enstellar:canonical-model:0.1.0.
plugins {
    java
}

group = "com.simintero.enstellar"
version = "0.1.0"

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

tasks.withType<JavaCompile> {
    options.compilerArgs.add("-parameters")
}

sourceSets {
    main {
        java.srcDirs(layout.projectDirectory.dir("../generated/java"))
    }
}

dependencies {
    // The generated records use @JsonProperty / @JsonInclude.
    implementation("com.fasterxml.jackson.core:jackson-annotations:2.17.2")
}
