import asyncio
import pydantic
from typing import Any
from pydantic import BaseModel, Field
import skyvern
from skyvern import RunContext, SkyvernPage


class WorkflowParameters(BaseModel):
    pass


class GeneratedWorkflowParameters(BaseModel):
    """Generated schema representing all input_text action values from the workflow run."""

    login_email: str = Field(description="Email address used for login", default="")
    login_password: str = Field(description="Password used for login", default="")
    input_email: str = Field(description="Email address to be input into the email field", default="")
    input_password: str = Field(description="Text to be input into the password field", default="")
    search_text: str = Field(description="Text to be input into the search field", default="")


@skyvern.workflow(title = 'Schedule a patient')
async def run_workflow(
    parameters: WorkflowParameters | dict[str, Any],
):
    parameters = parameters.model_dump() if isinstance(parameters, WorkflowParameters) else parameters
    page, context = await skyvern.setup(parameters, GeneratedWorkflowParameters)
    await skyvern.run_task(
        prompt = 'Navigate to https://dev.kintsugi.careexpandcloud.com/ and wait for the page to load. The task is complete once the page has loaded.', 
        url = 'https://dev.kintsugi.careexpandcloud.com/', 
        label = 's1_nav',
    )
    await skyvern.action(
        prompt = 'In the field "you@example.com", type the text: bladerunner@mailslurp.biz', 
        label = 's2_type',
    )
    await skyvern.action(
        prompt = 'In the field "••••••••", type the text: careexpandA', 
        label = 's3_type',
    )
    await skyvern.action(
        prompt = 'Click on: Sign in', 
        label = 's4_click',
    )
    await skyvern.action(
        prompt = 'Click on: Create Appointment', 
        label = 's5_click',
    )
    await skyvern.action(
        prompt = 'In the field "Search by name, patient ID, phone, email, birthdate, or gender", type the text: ca', 
        label = 's6_type',
    )
    await skyvern.action(
        prompt = 'In the field "Search by name, patient ID, phone, email, birthdate, or gender", type the text: ca', 
        label = 's7_type',
    )
    await skyvern.action(
        prompt = 'Click on: Select Provider', 
        label = 's8_click',
    )
    await skyvern.action(
        prompt = 'Click on: John Smithdemo', 
        label = 's9_click',
    )
    await skyvern.action(
        prompt = 'Click on: Loading healthcare services...', 
        label = 's10_click',
    )
    await skyvern.action(
        prompt = 'Click on: Select Healthcare Service', 
        label = 's11_click',
    )
    await skyvern.action(
        prompt = 'Click on: Urgent Care', 
        label = 's12_click',
    )


@skyvern.cached(cache_key = 's1_nav')
async def s1_nav(page: SkyvernPage, context: RunContext):
    await page.goto('https://dev.kintsugi.careexpandcloud.com/')
    await page.fill(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][2]/*[name()="main"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="form"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="input"][1]', 
        value = context.parameters['login_email'], 
        ai = 'fallback', 
        prompt = 'What email should be used for login?',
    )
    await page.fill(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][2]/*[name()="main"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="form"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][1]/*[name()="input"][1]', 
        value = context.parameters['login_password'], 
        ai = 'fallback', 
        prompt = f"What {context.parameters['login_password']} should be used for login?",
    )
    await page.click(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][2]/*[name()="main"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="form"][1]/*[name()="div"][2]/*[name()="button"][1]', 
        ai = 'fallback', 
        prompt = "Should the 'Sign in' button be clicked to proceed?",
    )
    await page.complete()


@skyvern.cached(cache_key = 's2_type')
async def s2_type(page: SkyvernPage, context: RunContext):
    await page.fill(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][2]/*[name()="main"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="form"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="input"][1]', 
        value = context.parameters['input_email'], 
        ai = 'fallback', 
        prompt = 'What email address should be input into the email field?',
    )


@skyvern.cached(cache_key = 's3_type')
async def s3_type(page: SkyvernPage, context: RunContext):
    await page.fill(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][2]/*[name()="main"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="form"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][1]/*[name()="input"][1]', 
        value = context.parameters['input_password'], 
        ai = 'fallback', 
        prompt = f"What text should be input into the {context.parameters['login_password']} field?",
    )


@skyvern.cached(cache_key = 's4_click')
async def s4_click(page: SkyvernPage, context: RunContext):
    await page.click(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][2]/*[name()="main"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="form"][1]/*[name()="div"][2]/*[name()="button"][1]', 
        ai = 'proactive', 
        prompt = "The 'Sign in' button with id 'AAAg' is the one that submits the form, which aligns with the user's intention to sign in.",
    )


@skyvern.cached(cache_key = 's5_click')
async def s5_click(page: SkyvernPage, context: RunContext):
    await page.click(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="main"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="button"][1]', 
        ai = 'proactive', 
        prompt = "The 'Create Appointment' button is the element that matches the user's instruction to create a new appointment.",
    )


@skyvern.cached(cache_key = 's6_type')
async def s6_type(page: SkyvernPage, context: RunContext):
    await page.fill(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][5]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="input"][1]', 
        value = context.parameters['search_text'], 
        ai = 'fallback', 
        prompt = 'What text should be input into the search field?',
    )


@skyvern.cached(cache_key = 's7_type')
async def s7_type(page: SkyvernPage, context: RunContext):
    await page.fill(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][5]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="div"][1]/*[name()="input"][1]', 
        value = context.parameters['search_text'], 
        ai = 'fallback', 
        prompt = 'What text should be input into the search field?',
    )


@skyvern.cached(cache_key = 's8_click')
async def s8_click(page: SkyvernPage, context: RunContext):
    await page.click(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][5]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][3]/*[name()="div"][1]/*[name()="div"][1]/*[name()="button"][1]', 
        ai = 'proactive', 
        prompt = "The action is to click on the 'Select Provider' dropdown to allow the user to choose a provider for the appointment. The element with id 'AAEc' matches the user's instruction.",
    )


@skyvern.cached(cache_key = 's9_click')
async def s9_click(page: SkyvernPage, context: RunContext):
    await page.click(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][1]/*[name()="div"][2]/*[name()="main"][1]/*[name()="header"][1]/*[name()="nav"][1]/*[name()="div"][1]/*[name()="button"][1]', 
        ai = 'proactive', 
        prompt = "The element with ID 'AACU' contains the text 'John Smithdemo', which matches the user's instruction to click on 'John Smithdemo'.",
    )


@skyvern.cached(cache_key = 's10_click')
async def s10_click(page: SkyvernPage, context: RunContext):
    await page.click(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][5]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][3]/*[name()="div"][1]/*[name()="div"][1]/*[name()="button"][1]', 
        ai = 'proactive', 
        prompt = 'Which provider should be selected to enable healthcare services?',
    )


@skyvern.cached(cache_key = 's11_click')
async def s11_click(page: SkyvernPage, context: RunContext):
    await page.click(
        selector = 'xpath=/*[name()="html"][1]/*[name()="body"][1]/*[name()="div"][5]/*[name()="div"][2]/*[name()="div"][1]/*[name()="div"][3]/*[name()="div"][1]/*[name()="div"][2]/*[name()="button"][1]', 
        ai = 'proactive', 
        prompt = "The element with ID 'AAEi' is labeled 'Select Healthcare Service', which directly matches the user's instruction to click on this option.",
    )
