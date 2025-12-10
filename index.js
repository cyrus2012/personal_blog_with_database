import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import session from "express-session";
import bcrypt from "bcrypt";
import pg from "pg";
import env from "dotenv";


const app = express();
const PORT = 4000;

app.use(bodyParser.urlencoded({ extended: true }));
//app.use(express.static("public"));
env.config();


// Configure sessions
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));


const saltRounds = 10;  //add salt to bcrypt


const blogDatabase = new pg.Client({
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
});

blogDatabase.connect();

//fetchArticle();


async function insertArticle(article){
  try{
    const result = await blogDatabase.query("INSERT INTO articles (title, content, date, owner_id) VALUES ($1, $2, $3, $4) RETURNING id", 
      [article.title, article.content, article.date, article.owner_id]
    );

  }catch(err){
    console.error("blog database has insert problem", err);
  }
}


async function updateArticle(article){
  try{
    const result = blogDatabase.query(
      "UPDATE articles SET title=$1, content=$2, date=$3 WHERE id=$4",
      [article.title, article.content, article.date, article.id]
    )
  }catch(err){
    console.error("fail to update blog database", err);
  }
}


async function fetchArticlesByOwner(owner_id){

  let result;

  try{
    if(owner_id){
      result = await blogDatabase.query("SELECT * FROM articles WHERE owner_id=$1 ORDER BY date DESC", [owner_id]);
    }else{
      result = await blogDatabase.query("SELECT * FROM articles ORDER BY date DESC");
    }
 
    return result.rows;

  }catch(err){
    console.log("fail to access blog database", err);
  }

}

async function fetchArticleById(article_id){

  let result;

  try{
    if(article_id){
      result = await blogDatabase.query(
        "SELECT articles.id, title, content, date, owner_id, users.username FROM articles " +
        "INNER JOIN users ON users.id=articles.owner_id WHERE articles.id=$1",
        [article_id]);
    }else{
      result = await blogDatabase.query("SELECT * FROM articles");
    }

    if(result.rows.length > 0)
      return result.rows[0];
    
    return null;

  }catch(err){
    console.log("fail to access blog database", err);
  }

}


async function deleteArticleById(acticleId){
  try{
    blogDatabase.query("DELETE FROM articles WHERE id=$1", [acticleId]);
  }catch(err){
    console.error("Problem occurs when delete a row in table articles", err);
  }
}
   

/**
 * return Date object
 * @param {*} inputDate a string in date format "yyyy-mm-dd", which received from HTML input tag with type="date"
 */
function createDateFromDateInput(inputDate){
    const [year, month, day] = inputDate.split("-");
    const date = new Date(year, month - 1, day, 0, 0, 0);
    return date;
}

function convertToStringFormatForDateInputTag(date){
    let dateString = date.toLocaleDateString("en-US", {year: "numeric", month: "2-digit", day: "2-digit",}); //String is mm/dd/yyyy
      //console.log("before replacement, date is " + dateString);
    const [month, day, year] = dateString.split('/');
    dateString = year + "-" + month + "-" + day;
    return dateString;
}



// Route to render the edit page
// This page can only been accessed after login
app.get('/edit/:articleID', async (req, res) =>{

  const user = req.session.user;
  if(!user){
    return res.redirect("/login");
  }

  const id = req.params.articleID;
  //check if articleID is digit number
  if(id.match(/^\d+$/)){ 
      
      const articleElement = await fetchArticleById(id);

      if(articleElement){

        if(user.id != articleElement.owner_id){
          console.error(`User ${user.id} cannot edit article owned by other.`);
          return res.send('404');    
        }

        const dateString = convertToStringFormatForDateInputTag(articleElement.date);
        return res.render("edit_article.ejs", {article:articleElement, date:dateString});
      }else{
        console.error(`Article with id S{id} does not exit.`);
        res.status(404).send("Article with id S{id} does not exit.");    
      }
  }else{
    console.log("URL:./article/XXX where XXX should be a positive number");
    res.status(400).send("URL:./article/XXX where XXX should be a positive number");
  }
  
});


// Route to create new article, update or delete an existing article. Then redirect to /admin page
app.post("/modified", async (req, res)=>{
  
  if(!req.session.user){
      return res.redirect("/login");
  }

  const user_id = req.session.user.id;  
  const action = req.body.action;

  //delete an article
  if(action === "Delete"){
    await deleteArticleById(req.body.deleteArticleId);
    console.log(`deleted article ${req.body.deleteArticleId}!`);

  //publish a new article
  }else if(action === "Publish"){
    
    const dateObj = createDateFromDateInput(req.body.date);
    const newArticle = {owner_id: user_id, title:req.body.title, date:dateObj, content:req.body.content};
    await insertArticle(newArticle);
    console.log("publish new article");

  //update the article
  }else if(action === "Update"){

    const dateObj = createDateFromDateInput(req.body.date);
    const newArticle = {
      owner_id: user_id,
      title:req.body.title, 
      date:dateObj, 
      content:req.body.content,
      id:req.body.articleId
    };

    await updateArticle(newArticle);
    console.log(`updated article ${newArticle.id}`);
  }
    
  res.redirect("/admin");

});


// Route to render the new article page
// This page can only been accessed after login
app.get("/new", (req, res) =>{

    //go to login page when user is guest
  if(!req.session.user){
    return res.redirect("/login");
  }

  const date = new Date();
  const dateString = convertToStringFormatForDateInputTag(date);
  res.render("edit_article.ejs", {date:dateString});
});

// Route to render admin page
// This page can only been accessed after login
app.get("/admin", async (req,res)=>{

  const user = req.session.user;
  //go to login page when user is guest
  if(!user){
    return res.redirect("/login");
  }
  
  const articlesArray = await fetchArticlesByOwner(user.id);
  res.render("admin.ejs", {articles:articlesArray, username:user.username});
});


app.get("/logout", (req, res)=>{
    
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: 'Logout failed' });
      }
      res.redirect("/home");
    });
});



app.post("/login", async (req, res)=>{
  const username = req.body.username;
  const password = req.body.password;
      
  try{
    const result = await blogDatabase.query("SELECT * FROM users WHERE username=$1", [username]);

    if(result.rows.length > 0){
      const loginUser = result.rows[0];

      //use bcrypt.compare() method compare the password typed in by user and that encrypted one stored in database
      bcrypt.compare(password, loginUser.password, (err, valid) => {
        if (err) {
          console.error("Error comparing passwords:", err);
          return res.render("login.ejs", {message:"Error: fail to comparing passwords"});    

        } else {
          if (valid) {
            req.session.user = {
              id: loginUser.id,
              username: loginUser.username
            };

            return res.redirect("/admin");
          
          } else {
            console.log("incorrect password.");
            return res.render("login.ejs", {message:"incorrect username or password."});    
          }
        }
      });

    }else{
      console.log("User not found");
      return res.render("login.ejs", {message:"incorrect username or password."});
    }

  }catch(err){
    console.error("fail to access blogDatabase", err);
    return res.render("login.ejs", {message:"database has access problem."});
  }
});



async function isUsernameExisted(username){
  
  const users = await blogDatabase.query("SELECT * FROM users WHERE username=$1", [username]);

    if(users.rows.length > 0){
      return true;
  } 

  return false;
}


async function addUser(name, password){
  try{
    if(await isUsernameExisted(name)){
      console.log("Username has been regitsered")
      return ;
    }

    bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);

        } else {
          try{
            //users.push({id:1, username:name, password:hash});
            const date = new Date().toISOString();
            const result = await blogDatabase.query("INSERT INTO users(username, password, create_date) VALUES ($1, $2, $3) RETURNING *;", 
              [name, hash, date]);

            const user = result.rows[0];          
            console.log("has regitsered. Now log in account");
            console.log(`${user.username} password: ${user.password}`);
          }catch(err){
            console.error("cannot insert user account.", err);
          }
        }
    });

  }catch(err){
      console.error(err);
  }
}


//addUser("user1", "aabbccdd");

app.post("/register", async (req, res)=>{
  const username = req.body.username;
  const password = req.body.password;

  try{
      if(await isUsernameExisted(username)){
          console.log("Username has been regitsered(after exam user name)")
          res.render("register.ejs", {message:`username ${username} has been used. Pleaes user another!`});
          return;
      }

      bcrypt.hash(password, saltRounds,  (err, hash) => {
          if (err) {
            console.error("Error hashing password:", err);
          } else {
              const date = new Date().toISOString();
              const result = blogDatabase.query("INSERT INTO users(username, password, create_date) VALUES ($1, $2, $3) RETURNING *",
                [username, hash, date]
              );

              console.log("has regitsered. Now log in account");
              res.redirect("/login");
          }
      });
  }catch(err){
    console.error(error);
  }
});

//Route to render register page
app.get("/register", (req, res)=>{
  res.render("register.ejs");
});

//Route to render login page
app.get("/login", (req, res)=>{
  res.render("login.ejs");
});


// Route to render the aritcle detail page
app.get('/article/:articleID', async (req, res) =>{
  const id = req.params.articleID;
   //check if articleID is digit number
  if(id.match(/^\d+$/)){ 
         
    try{
      const articleElement = await fetchArticleById(id);

      if(articleElement){
          return res.render("article.ejs", {article:articleElement, author:articleElement.username});
      }else{
        console.log("article with id ${id} does not exit.");
        return res.status(400).send("article with id ${id} does not exit.");
      }

    }catch(err){
      console.error("fail to access database table articles.", err);
      return res.status(500).send("fail to access database table articles.");
    }


  }else{
    console.log("URL:./article/XXX where XXX should be a positive number");
    res.status(400).send("URL:./article/XXX where XXX should be a positive number");
  }
  
});

// Route to render the Guset home page
app.get("/home", async (req, res) =>{
  
  const articlesArray = await fetchArticlesByOwner();
  res.render("guest_home.ejs", {articles:articlesArray});
});

app.get("/", (req, res) =>{
  res.redirect("/home");
});

app.listen(PORT, () => {
  console.log(`Listening to port ${PORT}`);
});

