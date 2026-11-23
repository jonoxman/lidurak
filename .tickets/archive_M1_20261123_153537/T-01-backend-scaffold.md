# T-01: Backend Project Scaffolding (Scala 3 / sbt)

## Objective
Create the `backend/` sbt project with all Milestone 1 dependencies, a compiling `Main.scala` entry point, and a passing trivial MUnit test to confirm the build pipeline works.

## Requirements

### Directory Structure
```
backend/
├── build.sbt
├── project/
│   └── build.properties
└── src/
    ├── main/
    │   └── scala/
    │       └── durak/
    │           └── Main.scala
    └── test/
        └── scala/
            └── durak/
                └── MainSuite.scala
```

### `project/build.properties`
```
sbt.version=1.9.8
```

### `build.sbt`
- `scalaVersion := "3.3.3"`
- `name := "durak-backend"`
- Dependencies (use latest stable minor versions compatible with Scala 3.3.x):
  - `"org.http4s" %% "http4s-ember-server" % "0.23.27"`
  - `"org.http4s" %% "http4s-dsl" % "0.23.27"`
  - `"org.http4s" %% "http4s-circe" % "0.23.27"`
  - `"org.typelevel" %% "cats-effect" % "3.5.4"`
  - `"io.circe" %% "circe-generic" % "0.14.7"`
  - `"io.circe" %% "circe-parser" % "0.14.7"`
  - Test dependencies:
    - `"org.scalameta" %% "munit" % "1.0.0" % Test`
    - `"org.typelevel" %% "munit-cats-effect" % "2.0.0" % Test`
- `testFrameworks += new TestFramework("munit.Framework")`
- `fork := true` (recommended for Cats Effect apps)

### `Main.scala`
```scala
package durak

import cats.effect.*

object Main extends IOApp.Simple:
  def run: IO[Unit] =
    IO.println("Durak server starting...")
```

### `MainSuite.scala`
A trivial MUnit test asserting `1 + 1 == 2` to verify the test pipeline compiles and runs.

## Acceptance Criteria
- [ ] `cd backend && sbt compile` completes with zero errors
- [ ] `cd backend && sbt test` runs `MainSuite` and reports all tests passed

## Verification Command
```bash
cd backend && sbt test
```

