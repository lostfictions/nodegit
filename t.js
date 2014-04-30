var repo = require("./").Repo;

// Open the repository.
repo.open("./.git")

// And then...
.then(function(repo) {
  console.log(repo);
});
