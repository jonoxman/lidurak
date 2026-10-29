ThisBuild / scalaVersion := "3.3.3"

lazy val root = (project in file("."))
  .settings(
    name := "durak-backend",
    libraryDependencies ++= Seq(
      "org.http4s" %% "http4s-ember-server" % "0.23.27",
      "org.http4s" %% "http4s-dsl" % "0.23.27",
      "org.http4s" %% "http4s-circe" % "0.23.27",
      "org.typelevel" %% "cats-effect" % "3.5.4",
      "io.circe" %% "circe-generic" % "0.14.7",
      "io.circe" %% "circe-parser" % "0.14.7",
      "org.scalameta" %% "munit" % "1.0.0" % Test,
      "org.typelevel" %% "munit-cats-effect" % "2.0.0" % Test
    ),
    testFrameworks += new TestFramework("munit.Framework"),
    fork := true
  )
