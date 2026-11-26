<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in BACKUP_FEEDBACK.md and .reviews/feedback_archive/ -->
# QA responses
3. Bug: On first loading the page, the generic "Guest" name is shown. Only after reloading the page does the generated Guest-XXXX name display. The same name should display consistently from the moment the user loads the page - at no time should the user be able to see a generic placeholder.
6. It seems to work correctly. However, also grey out the 36 card option in the Create a Game menu if it is not valid to select (because there are 4 players). 

# New
1. Clicking the top-left LIDURAK logo in the header bar returns the user to the home page correctly, but keeps the current URL shown in the browser bar the same, adding #/ at the end of it. Instead, it should just go back to the homepage and set the URL to be exactly the home page. Also apply this change to any other such navigation elements (if there are any) - no element should ever put #/ at the end of the URL.
